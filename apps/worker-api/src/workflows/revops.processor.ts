import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, DelayedError, UnrecoverableError } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaClient, RunStatus } from '@prisma/client';
import { PrismaService, TenantContext } from '@vexel/database';
import { createHash } from 'crypto';
import { VexelLockService } from '../redis/vexel-lock.service';
import { AnvilStepContext } from '@vexel/anvil-engine';
import {
  EnvelopeCryptoService,
  HubSpotEntityResolverService,
  HubSpotHttpClient,
  HubSpotOwnerResolverService,
  HubSpotSyncOutcome,
  HubSpotTokenManagerService,
  HubSpotUndoSnapshot,
  HubSpotV4SyncService,
  ResolvedHubSpotContext,
  WhatsAppApprovalService,
} from '@vexel/crm-hubspot';
import {
  BilingualTranscriberService,
  CrmTransitionPayload,
  MergedTranscriptBundle,
  PipelineStageCacheService,
  RepOverrideParserService,
  UsageMeterService,
  ZodExtractorService,
} from '@vexel/extractor';

@Processor('vexel-workflows', { concurrency: 10 })
export class RevOpsWorkflowProcessor extends WorkerHost {
  private readonly logger = new Logger(RevOpsWorkflowProcessor.name);
  private readonly usageMeter: UsageMeterService;
  private readonly bilingualTranscriber: BilingualTranscriberService;
  private readonly zodExtractor: ZodExtractorService;
  private readonly stageCache: PipelineStageCacheService;
  private readonly tokenManager: HubSpotTokenManagerService;
  private readonly entityResolver: HubSpotEntityResolverService;
  private readonly whatsappApproval: WhatsAppApprovalService;
  private readonly hubspotV4Sync: HubSpotV4SyncService;
  private readonly ownerResolver: HubSpotOwnerResolverService;
  private readonly repOverrideParser: RepOverrideParserService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: VexelLockService,
  ) {
    super();
    const rawPrisma = this.prisma.client as unknown as PrismaClient;
    this.usageMeter = new UsageMeterService(rawPrisma);
    this.bilingualTranscriber = new BilingualTranscriberService(this.usageMeter);
    this.stageCache = new PipelineStageCacheService(this.lockService.redis);
    this.zodExtractor = new ZodExtractorService(this.usageMeter, this.stageCache);
    this.repOverrideParser = new RepOverrideParserService(this.usageMeter);

    const envelopeCrypto = new EnvelopeCryptoService();
    this.tokenManager = new HubSpotTokenManagerService(
      rawPrisma,
      this.lockService.redis,
      envelopeCrypto,
    );
    const httpClient = new HubSpotHttpClient(this.lockService.redis, this.tokenManager);
    this.entityResolver = new HubSpotEntityResolverService(httpClient);
    this.whatsappApproval = new WhatsAppApprovalService(this.lockService.redis);
    this.hubspotV4Sync = new HubSpotV4SyncService(httpClient);
    this.ownerResolver = new HubSpotOwnerResolverService(
      this.prisma.client,
      this.lockService.redis,
      httpClient,
    );
  }

  async process(job: Job, token?: string): Promise<any> {
    const { tenantId, senderPhone, mode, runId: existingRunId, approved, editedPatch, rawRepOverrideText } = job.data;

    // Bind tenantId to AsyncLocalStorage for the entire lifecycle of this BullMQ job
    return TenantContext.run(tenantId, async () => {
      // Every prisma.workflowRun, prisma.workflowStep, and prisma.usageLedger query
      // inside this callback automatically injects tenantId and enforces PostgreSQL RLS!
      const lockEntityKey = senderPhone || existingRunId;

      // 1. Acquire Distributed Redis Deal/Contact Lock
      const lockToken = await this.lockService.acquireDealLock(tenantId, lockEntityKey, 45000);
      if (!lockToken) {
        this.logger.warn(`Lock contention on ${lockEntityKey}; delaying job by 5s without burning attempt.`);
        await job.moveToDelayed(Date.now() + 5000, token);
        throw new DelayedError();
      }

      // Start background lock heartbeat every 15s while job runs
      const heartbeat = setInterval(() => {
        this.lockService.extendDealLock(tenantId, lockEntityKey, lockToken, 45000);
      }, 15000);

      try {
        // 2. Initialize or Load Durable WorkflowRun
        const run = await this.getOrCreateWorkflowRun(tenantId, senderPhone, existingRunId, job.id!);
        if (!run) {
          return { status: 'empty_buffer_skipped' };
        }

        const anvil = new AnvilStepContext(
          this.prisma.client,
          run.id,
          tenantId,
        );

        // Handle Rep Rejection if resuming from approval
        if (mode === 'RESUME_AFTER_APPROVAL' && approved === false) {
          await this.prisma.workflowRun.update({
            where: { id: run.id },
            data: { status: RunStatus.COMPLETED, completedAt: new Date() },
          });
          return { status: 'rejected_by_rep', runId: run.id };
        }

        // Handle 15-Minute Undo Rollback Branch inside the Redis Deal Lock
        if (mode === 'ROLLBACK_AUTO_SYNC' && job.data.undoSnapshot) {
          const snapshot: HubSpotUndoSnapshot = job.data.undoSnapshot;

          const rollbackOutcome = await anvil.run('step-7-rollback-hubspot-sync', async () => {
            return this.hubspotV4Sync.rollbackSyncIdempotently(tenantId, snapshot);
          });

          await this.prisma.workflowRun.update({
            where: { id: run.id },
            data: {
              errorMessage: `Reverted by rep via 15m Undo button (${rollbackOutcome.dealAction})`,
            },
          });

          const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
          const actionSummary =
            rollbackOutcome.dealAction === 'ARCHIVED_NEW_DEAL'
              ? `Archived newly created Deal *${snapshot.dealName}*`
              : `Restored *${snapshot.dealName}* to stage *${snapshot.previousDealStage ?? 'prior'}*`;

          await this.whatsappApproval.sendUndoStatusNotice({
            whatsappPhoneNumberId: tenant.whatsappPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID!,
            whatsappAccessToken: process.env.WHATSAPP_SYSTEM_TOKEN!,
            repDestinationPhone: snapshot.repPhone,
            replyToMessageId: snapshot.receiptWhatsappMessageId,
            text: `↩️ *Vexel Sync Reverted:* ${actionSummary} and removed the timeline note/task from HubSpot.`,
          });

          return { status: 'rolled_back_successfully', runId: run.id, rollbackOutcome };
        }

        try {
          // STEP 1: Transcribe Audio & Merge Conversation Window
          const transcriptBundle = await anvil.run('step-1-transcribe-window', async () => {
            const messages = (run.inputPayload as any).messages as any[];
            // Calls Deepgram/Whisper for audio items & logs audioSeconds to UsageLedger
            return this.transcribeAndMergeBatch(tenantId, run.id, messages);
          });

          // STEP 2: Deterministic HubSpot Contact & Active Deal Resolution
          const crmContext = await anvil.run('step-2-resolve-hubspot-entities', async () => {
            return this.resolveHubSpotEntities(tenantId, transcriptBundle.senderPhone);
          });

          // STEP 3: Schema-Validated LLM Extraction + Token Metering
          const extraction = await anvil.run('step-3-extract-zod-schema', async () => {
            return this.extractCrmTransitionWithZod(tenantId, run.id, transcriptBundle, crmContext);
          });

          // STEP 4: Confidence Gate & Human-in-the-Loop Pause
          const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
          const needsApproval =
            mode !== 'RESUME_AFTER_APPROVAL' &&
            extraction.confidenceScore <= tenant.autoSyncThreshold;

          if (needsApproval) {
            await anvil.run('step-4-dispatch-approval-prompt', async () => {
              await this.prisma.workflowRun.update({
                where: { id: run.id },
                data: {
                  status: RunStatus.WAITING_APPROVAL,
                  extractedData: extraction,
                  confidenceScore: extraction.confidenceScore,
                },
              });
              return this.sendInteractiveApprovalPrompt(tenantId, run.id, crmContext, extraction);
            });

            this.logger.log(`Run ${run.id} paused in WAITING_APPROVAL (Confidence: ${extraction.confidenceScore}%)`);
            return { status: 'paused_waiting_for_approval', runId: run.id };
          }

          // STEP 4B: Apply Rep Text Override if resuming with rawRepOverrideText
          let finalPayload = editedPatch ? { ...extraction, ...editedPatch } : extraction;

          if (mode === 'RESUME_AFTER_APPROVAL' && job.data.rawRepOverrideText) {
            const overrideResult = await anvil.run('step-4b-apply-rep-override', async () => {
              const tenantStages = await this.stageCache.getTenantStages(
                tenantId,
                null, // Already cached in Redis or fetched via HubSpotTokenManagerService
                crmContext.pipelineId ?? 'default',
              );

              return this.repOverrideParser.parseRepTextOverride({
                tenantId,
                runId: run.id,
                rawRepText: job.data.rawRepOverrideText,
                existingPayload: extraction,
                tenantStages,
              });
            });

            if (overrideResult.action === 'REJECT') {
              await this.prisma.workflowRun.update({
                where: { id: run.id },
                data: { status: RunStatus.COMPLETED, completedAt: new Date() },
              });
              return { status: 'rejected_by_rep_text', runId: run.id };
            }

            finalPayload = overrideResult.mergedPayload;
          }

          // STEP 5: Idempotent HubSpot v4 Batch Sync with Stale-Stage Recovery
          let syncResult: HubSpotSyncOutcome;
          try {
            syncResult = await anvil.run('step-5-sync-hubspot-v4', async () => {
              return this.syncToHubSpotV4(
                tenantId,
                run.id,
                transcriptBundle.senderPhone,
                crmContext,
                finalPayload,
              );
            });
          } catch (err: any) {
            if (err?.isStaleDealStage === true || err?.name === 'StaleDealStageError') {
              const pipelineId = crmContext.pipelineId ?? 'default';

              this.logger.warn(
                `[Self-Healing] Stale HubSpot dealstage "${finalPayload.dealStage}" detected on run ${run.id}. Evicting Redis pipeline cache & Step 3 output...`,
              );

              // 1. Purge stale custom stages from Redis so next run fetches live from HubSpot
              await this.stageCache.invalidateTenantStages(tenantId, pipelineId);

              // 2. Evict Step 3, 4, 4b, and 5 from Anvil PG step cache (preserving Step 1 Audio & Step 2 CRM lookup)
              await anvil.invalidateSteps(
                [
                  'step-3-extract-zod-schema',
                  'step-4-dispatch-approval-prompt',
                  'step-4b-apply-rep-override',
                  'step-5-sync-hubspot-v4',
                ],
                `Stale HubSpot stage ID "${finalPayload.dealStage}" rejected by API`,
              );
            }

            throw err;
          }

          // STEP 6: Non-Blocking 1-Line WhatsApp Confirmation Receipt with HubSpot Deep Link
          try {
            await anvil.run('step-6-send-whatsapp-receipt', async () => {
              return this.dispatchCompletionReceipt({
                tenantId,
                runId: run.id,
                mode,
                hasRepOverride: Boolean(job.data.rawRepOverrideText || editedPatch),
                crmContext,
                finalPayload,
                syncResult,
              });
            });
          } catch (receiptErr: any) {
            // Never fail a completed HubSpot CRM sync if the WhatsApp receipt notification fails
            this.logger.warn(
              `[Non-Fatal] Step 5 synced Deal ${syncResult.dealId}, but Step 6 WhatsApp receipt failed: ${receiptErr?.message}`,
            );
          }

          // Commit final workflow state + audit usage in 1 RLS-pinned transaction
          await this.prisma.$withTenantTransaction(async (tx) => {
            // 1. Uses `tx` explicitly
            await tx.workflowRun.update({
              where: { id: run.id },
              data: {
                status: RunStatus.COMPLETED,
                externalDealId: syncResult.dealId,
                extractedData: finalPayload as any,
                confidenceScore: finalPayload.confidenceScore,
                completedAt: new Date(),
              },
            });

            // 2. Ambiently reuses the exact same PostgreSQL connection & set_config session
            // even though UsageMeterService calls `this.prisma.usageLedger.create()` internally!
            await this.usageMeter.recordLlmUsage({
              tenantId,
              runId: run.id,
              provider: 'hubspot-v4-sync-commit',
              promptTokens: 0,
              completionTokens: 0,
            });
          });

          return { status: 'completed', runId: run.id, dealId: syncResult.dealId };
        } catch (err: any) {
          // 1. Rate-Limit Backpressure: Delay BullMQ job without burning an attempt
          if (err?.isRateLimitError === true || err?.name === 'HubSpotRateLimitError') {
            const retryAfterMs = Number(err.retryAfterMs) || 10_000;
            this.logger.warn(
              `[Rate-Limit Backoff] Tenant ${tenantId} paused for ${retryAfterMs}ms (${err.message})`,
            );
            await job.moveToDelayed(Date.now() + retryAfterMs, token);
            throw new DelayedError();
          }

          // 2. Permanent OAuth Revocation: Move run to DEAD_LETTER and skip remaining BullMQ attempts
          if (err?.isPermanentOAuthError === true || err?.name === 'HubSpotOAuthRevokedError') {
            await this.prisma.workflowRun.updateMany({
              where: { id: run.id },
              data: {
                status: RunStatus.DEAD_LETTER,
                errorMessage: err.message,
              },
            });
            throw new UnrecoverableError(err.message);
          }

          throw err;
        }
      } finally {
        clearInterval(heartbeat);
        await this.lockService.releaseDealLock(tenantId, lockEntityKey, lockToken);
      }
    });
  }

  private async getOrCreateWorkflowRun(
    tenantId: string,
    senderPhone: string,
    existingRunId: string | undefined,
    jobId: string,
  ) {
    if (existingRunId) {
      return this.prisma.workflowRun.update({
        where: { id: existingRunId },
        data: { status: RunStatus.RUNNING },
      });
    }

    // Drain the Redis debounce buffer only on the initial run creation
    const bufferedMessages = await this.lockService.flushBuffer(tenantId, senderPhone);
    if (bufferedMessages.length === 0) {
      // Retry recovery: look up if run was already created before a step failure
      const retryHash = createHash('sha256').update(`${tenantId}:${jobId}`).digest('hex');
      return this.prisma.workflowRun.findUnique({ where: { idempotencyKey: retryHash } });
    }

    const batchIdempotencyKey = createHash('sha256')
      .update(`${tenantId}:${bufferedMessages.map((m) => m.messageId).join(',')}`)
      .digest('hex');

    return this.prisma.workflowRun.upsert({
      where: { idempotencyKey: batchIdempotencyKey },
      update: { status: RunStatus.RUNNING },
      create: {
        tenantId,
        idempotencyKey: batchIdempotencyKey,
        workflowName: 'omnichannel-to-hubspot-v1',
        status: RunStatus.RUNNING,
        inputPayload: { senderPhone, messages: bufferedMessages } as any,
      },
    });
  }

  private async transcribeAndMergeBatch(tenantId: string, runId: string, messages: any[]) {
    await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return this.bilingualTranscriber.transcribeAndMergeBatch(
      tenantId,
      runId,
      process.env.WHATSAPP_SYSTEM_TOKEN!,
      messages,
    );
  }

  private async resolveHubSpotEntities(tenantId: string, senderPhone: string) {
    return this.entityResolver.resolveBySenderPhone(tenantId, senderPhone);
  }

  private async extractCrmTransitionWithZod(
    tenantId: string,
    runId: string,
    bundle: MergedTranscriptBundle,
    crmContext: ResolvedHubSpotContext,
  ) {
    let hubspotAccessToken: string | null = null;
    try {
      hubspotAccessToken = await this.tokenManager.getValidAccessToken(tenantId);
    } catch (err: any) {
      // Rethrow permanent OAuth revocations immediately; fall back to default stages if tenant simply hasn't connected OAuth yet
      if (err?.isPermanentOAuthError === true || err?.name === 'HubSpotOAuthRevokedError') {
        throw err;
      }
    }
    return this.zodExtractor.extractTransition(tenantId, runId, hubspotAccessToken, bundle, crmContext);
  }

  private async sendInteractiveApprovalPrompt(
    tenantId: string,
    runId: string,
    crmContext: ResolvedHubSpotContext,
    payload: CrmTransitionPayload,
  ) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const fallbackPhone =
      tenant.fallbackApprovalPhone || process.env.DEFAULT_REP_APPROVAL_PHONE!;

    // Resolve Deal/Contact Owner -> Rep's personal WhatsApp via Redis Hash cache (~0.4ms)
    const ownerRoute = await this.ownerResolver.resolveApprovalDestination(
      tenantId,
      crmContext.contactOwnerId,
      fallbackPhone,
    );

    // If routed to fallback admin because rep hasn't linked WhatsApp, prepend notice to reasoning
    const enrichedPayload: CrmTransitionPayload = ownerRoute.isFallbackRoute
      ? {
          ...payload,
          confidenceReasoning: `[Routed to Fallback — ${ownerRoute.fallbackReason}] ${payload.confidenceReasoning}`,
        }
      : payload;

    const cardResult = await this.whatsappApproval.sendRepApprovalCard({
      tenantId,
      runId,
      whatsappPhoneNumberId: tenant.whatsappPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID!,
      whatsappAccessToken: process.env.WHATSAPP_SYSTEM_TOKEN!,
      repDestinationPhone: ownerRoute.destinationWhatsappPhone,
      crmContext,
      payload: enrichedPayload,
    });

    await this.whatsappApproval.registerPendingApprovalSession({
      tenantId,
      runId,
      repPhone: ownerRoute.destinationWhatsappPhone,
      whatsappMessageId: cardResult.whatsappMessageId,
    });

    return cardResult;
  }

  private async syncToHubSpotV4(
    tenantId: string,
    runId: string,
    senderPhone: string,
    crmContext: ResolvedHubSpotContext,
    payload: CrmTransitionPayload,
  ) {
    return this.hubspotV4Sync.syncTransitionIdempotently({
      tenantId,
      runId,
      senderPhone,
      crmContext,
      payload,
    });
  }
  private async dispatchCompletionReceipt(params: {
    tenantId: string;
    runId: string;
    mode: string;
    hasRepOverride: boolean;
    crmContext: ResolvedHubSpotContext;
    finalPayload: CrmTransitionPayload;
    syncResult: HubSpotSyncOutcome;
  }) {
    const {
      tenantId,
      runId,
      mode,
      hasRepOverride,
      crmContext,
      finalPayload,
      syncResult,
    } = params;

    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const fallbackPhone =
      tenant.fallbackApprovalPhone || process.env.DEFAULT_REP_APPROVAL_PHONE!;

    // 1. Resolve Deal Owner -> Rep's bound WhatsApp number from Redis Hash (~0.4ms)
    const ownerRoute = await this.ownerResolver.resolveApprovalDestination(
      tenantId,
      crmContext.contactOwnerId,
      fallbackPhone,
    );

    // 2. Map internal HubSpot stage ID (e.g., "14928374") to human-readable label ("Contract Sent")
    const stages = await this.stageCache.getTenantStages(
      tenantId,
      null,
      crmContext.pipelineId ?? 'default',
    );
    const effectiveStageId =
      finalPayload.dealStage === 'unchanged'
        ? crmContext.currentDealStage ?? 'appointmentscheduled'
        : finalPayload.dealStage;

    const matchedStage = stages.find((s) => s.id === effectiveStageId);
    const stageLabel = matchedStage?.label ?? effectiveStageId;

    // 3. Look up the approval card wamid from Step 4 if we want to thread the reply
    const step4Record = await this.prisma.workflowStep.findUnique({
      where: {
        runId_stepKey: { runId, stepKey: 'step-4-dispatch-approval-prompt' },
      },
    });
    const approvalCardWamid = (step4Record?.outputData as any)?.whatsappMessageId;

    const syncMode =
      mode === 'RESUME_AFTER_APPROVAL'
        ? hasRepOverride
          ? 'REP_OVERRIDDEN'
          : 'REP_APPROVED'
        : 'AUTO_SYNC';

    const dealName =
      crmContext.currentDealName ??
      finalPayload.dealName ??
      crmContext.contactName ??
      `Deal #${syncResult.dealId}`;

    return this.whatsappApproval.sendSyncConfirmationReceipt({
      tenantId,
      runId,
      whatsappPhoneNumberId: tenant.whatsappPhoneId || process.env.WHATSAPP_PHONE_NUMBER_ID!,
      whatsappAccessToken: process.env.WHATSAPP_SYSTEM_TOKEN!,
      repDestinationPhone: ownerRoute.destinationWhatsappPhone,
      hubspotPortalId: tenant.hubspotPortalId,
      dealId: syncResult.dealId,
      dealName,
      stageLabel,
      amount: finalPayload.amount ?? crmContext.currentAmount,
      currency: finalPayload.currency ?? 'USD',
      syncMode,
      replyToWhatsappMessageId: approvalCardWamid,
      undoSnapshot:
        syncMode === 'AUTO_SYNC'
          ? {
              tenantId,
              runId,
              repPhone: ownerRoute.destinationWhatsappPhone,
              hubspotPortalId: tenant.hubspotPortalId,
              dealId: syncResult.dealId,
              dealName,
              createdNewDeal: syncResult.createdNewDeal,
              previousDealStage: crmContext.currentDealStage,
              previousAmount: crmContext.currentAmount,
              noteId: syncResult.noteId,
              taskId: syncResult.taskId,
            }
          : undefined,
    });
  }
}
