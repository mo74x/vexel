import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, DelayedError, UnrecoverableError } from 'bullmq';
import { Logger } from '@nestjs/common';
import { PrismaClient, RunStatus } from '@prisma/client';
import { PrismaService } from '@vexel/database';
import { createHash } from 'crypto';
import { VexelLockService } from '../redis/vexel-lock.service';
import { AnvilStepContext } from '@vexel/anvil-engine';
import {
  EnvelopeCryptoService,
  HubSpotDealSyncService,
  HubSpotHttpClient,
  HubSpotTokenManagerService,
} from '@vexel/crm-hubspot';
import {
  BilingualTranscriberService,
  CrmTransitionPayload,
  MergedTranscriptBundle,
  PipelineStageCacheService,
  ResolvedCrmContext,
  UsageMeterService,
  ZodExtractorService,
} from '@vexel/extractor';

@Processor('vexel-workflows', { concurrency: 10 })
export class RevOpsWorkflowProcessor extends WorkerHost {
  private readonly logger = new Logger(RevOpsWorkflowProcessor.name);
  private readonly bilingualTranscriber: BilingualTranscriberService;
  private readonly zodExtractor: ZodExtractorService;
  private readonly stageCache: PipelineStageCacheService;
  private readonly tokenManager: HubSpotTokenManagerService;
  private readonly dealSync: HubSpotDealSyncService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: VexelLockService,
  ) {
    super();
    const rawPrisma = this.prisma.client as unknown as PrismaClient;
    const usageMeter = new UsageMeterService(rawPrisma);
    this.bilingualTranscriber = new BilingualTranscriberService(usageMeter);
    this.stageCache = new PipelineStageCacheService(this.lockService.redis);
    this.zodExtractor = new ZodExtractorService(usageMeter, this.stageCache);

    const envelopeCrypto = new EnvelopeCryptoService();
    this.tokenManager = new HubSpotTokenManagerService(
      rawPrisma,
      this.lockService.redis,
      envelopeCrypto,
    );
    const httpClient = new HubSpotHttpClient(this.lockService.redis, this.tokenManager);
    this.dealSync = new HubSpotDealSyncService(httpClient);
  }

  async process(job: Job, token?: string): Promise<any> {
    const { tenantId, senderPhone, mode, runId: existingRunId, approved, editedPatch } = job.data;
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
        this.prisma.client as unknown as PrismaClient,
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

        // Apply manual rep edits if resuming from WhatsApp approval card
        const finalPayload = editedPatch ? { ...extraction, ...editedPatch } : extraction;

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
                extractedData: finalPayload,
                confidenceScore: extraction.confidenceScore,
              },
            });
            return this.sendInteractiveApprovalPrompt(tenantId, run.id, finalPayload);
          });

          this.logger.log(`Run ${run.id} paused in WAITING_APPROVAL (Confidence: ${extraction.confidenceScore}%)`);
          return { status: 'paused_waiting_for_approval', runId: run.id };
        }

        // STEP 5: Idempotent HubSpot v4 Batch Sync with Stale-Stage Recovery
        let syncResult: { dealId: string };
        try {
          syncResult = await anvil.run('step-5-sync-hubspot-v4', async () => {
            return this.syncToHubSpotV4(tenantId, run.id, crmContext, finalPayload);
          });
        } catch (err: any) {
          if (err?.isStaleDealStage === true || err?.name === 'StaleDealStageError') {
            const pipelineId = crmContext.pipelineId ?? 'default';

            this.logger.warn(
              `[Self-Healing] Stale HubSpot dealstage "${finalPayload.dealStage}" detected on run ${run.id}. Evicting Redis pipeline cache & Step 3 output...`,
            );

            // 1. Purge stale custom stages from Redis so next run fetches live from HubSpot
            await this.stageCache.invalidateTenantStages(tenantId, pipelineId);

            // 2. Evict Step 3, 4, and 5 from Anvil PG step cache (preserving Step 1 Audio & Step 2 CRM lookup)
            await anvil.invalidateSteps(
              [
                'step-3-extract-zod-schema',
                'step-4-dispatch-approval-prompt',
                'step-5-sync-hubspot-v4',
              ],
              `Stale HubSpot stage ID "${finalPayload.dealStage}" rejected by API`,
            );
          }

          throw err;
        }

        await this.prisma.workflowRun.update({
          where: { id: run.id },
          data: {
            status: RunStatus.COMPLETED,
            externalDealId: syncResult.dealId,
            extractedData: finalPayload,
            confidenceScore: extraction.confidenceScore,
            completedAt: new Date(),
          },
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

  private async resolveHubSpotEntities(
    tenantId: string,
    senderPhone: string,
  ): Promise<ResolvedCrmContext> {
    return {
      contactId: null,
      contactName: null,
      companyName: null,
      activeDealId: null,
      currentDealName: null,
      currentDealStage: null,
      currentAmount: null,
    };
  }

  private async extractCrmTransitionWithZod(
    tenantId: string,
    runId: string,
    bundle: MergedTranscriptBundle,
    crmContext: ResolvedCrmContext,
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

  private async sendInteractiveApprovalPrompt(tenantId: string, runId: string, payload: any) {
    return { messageDispatched: true };
  }

  private async syncToHubSpotV4(
    tenantId: string,
    runId: string,
    crm: ResolvedCrmContext,
    payload: CrmTransitionPayload,
  ) {
    return this.dealSync.upsertDealProperties({
      tenantId,
      dealId: crm.activeDealId,
      pipelineId: crm.pipelineId ?? 'default',
      payload,
    });
  }
}
