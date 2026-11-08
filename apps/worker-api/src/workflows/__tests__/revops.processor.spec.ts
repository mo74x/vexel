import { RevOpsWorkflowProcessor } from '../revops.processor';
import { RunStatus } from '@prisma/client';

describe('RevOpsWorkflowProcessor', () => {
  let mockPrisma: any;
  let mockLockService: any;
  let processor: RevOpsWorkflowProcessor;

  beforeEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'wa_phone_100';
    process.env.WHATSAPP_SYSTEM_TOKEN = 'wa_sys_token';
    process.env.DEFAULT_REP_APPROVAL_PHONE = '+201000000001';
    process.env.VEXEL_KEK_V1 =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.OPENAI_API_KEY = 'sk-test-openai-key';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    const stepStore = new Map<string, any>();

    mockPrisma = {
      client: {
        tenant: {
          findUnique: async () => ({
            id: 'tenant_acme',
            whatsappAccessToken: null,
          }),
        },
        workflowStep: {
          findUnique: async ({ where }: any) => {
            const key = `${where.runId_stepKey.runId}:${where.runId_stepKey.stepKey}`;
            return stepStore.get(key) ?? null;
          },
          upsert: async ({ where, update, create }: any) => {
            const key = `${where.runId_stepKey.runId}:${where.runId_stepKey.stepKey}`;
            const val = stepStore.has(key) ? { ...stepStore.get(key), ...update } : create;
            stepStore.set(key, val);
            return val;
          },
        },
        $withTenantTransaction: async (cb: any) =>
          cb({
            workflowStep: {
              upsert: async ({ where, update, create }: any) => {
                const key = `${where.runId_stepKey.runId}:${where.runId_stepKey.stepKey}`;
                const val = stepStore.has(key) ? { ...stepStore.get(key), ...update } : create;
                stepStore.set(key, val);
                return val;
              },
            },
            workflowRun: {
              update: async () => ({}),
            },
          }),
      },
      tenant: {
        findUniqueOrThrow: async () => ({
          id: 'tenant_acme',
          hubspotPortalId: '14429103',
          whatsappPhoneId: 'wa_phone_100',
          fallbackApprovalPhone: '+201000000001',
          autoSyncThreshold: 85,
        }),
      },
      workflowRun: {
        update: async ({ where, data }: any) => ({
          id: where.id,
          status: data.status ?? RunStatus.RUNNING,
          inputPayload: { senderPhone: '+201005556677', messages: [] },
        }),
        updateMany: async ({ data }: any) => data,
      },
      $withTenantTransaction: async (cb: any) =>
        cb({
          workflowStep: {
            upsert: async () => ({}),
          },
          workflowRun: {
            update: async () => ({}),
          },
        }),
      workflowStep: {
        findUnique: async () => null,
      },
    };

    mockLockService = {
      redis: {},
      acquireDealLock: async () => 'lock_tok_123',
      extendDealLock: async () => true,
      releaseDealLock: async () => true,
    };

    processor = new RevOpsWorkflowProcessor(mockPrisma, mockLockService);
  });

  it('arms Force Overwrite snapshot and sends interactive conflict card when ROLLBACK_AUTO_SYNC detects an OCC manual edit', async () => {
    let armedSnapshot: any = null;
    let conflictCardParams: any = null;

    (processor as any).hubspotV4Sync = {
      rollbackSyncIdempotently: async () => ({
        dealAction: 'CONFLICT_PRESERVED_MANUAL_EDIT',
        conflictingFields: ['dealstage'],
        lastModifiedBySource: 'CRM_UI',
        noteDeleted: true,
        taskDeleted: true,
      }),
    };

    (processor as any).whatsappApproval = {
      armForceUndoSnapshot: async (snap: any) => {
        armedSnapshot = snap;
      },
      sendUndoConflictNotice: async (params: any) => {
        conflictCardParams = params;
        return { messageId: 'wamid.conflict_card' };
      },
    };

    const undoSnapshot = {
      tenantId: 'tenant_acme',
      runId: 'run_occ_01',
      repPhone: '+201001234567',
      hubspotPortalId: '14429103',
      dealId: 'deal_500',
      dealName: 'Acme Cloud Deal',
      createdNewDeal: false,
      previousDealStage: 'qualifiedtobuy',
      previousAmount: 20000,
      syncedDealLastModifiedMs: 1762540000000,
      committedDealStage: 'contractsent',
      committedAmount: 35000,
      noteId: 'note_1',
      taskId: 'task_1',
      receiptWhatsappMessageId: 'wamid.receipt_500',
    };

    const result = await processor.process({
      id: 'job_undo_1',
      data: {
        tenantId: 'tenant_acme',
        runId: 'run_occ_01',
        mode: 'ROLLBACK_AUTO_SYNC',
        undoSnapshot,
      },
    } as any);

    expect(result.status).toBe('rolled_back_with_conflict');
    expect(armedSnapshot).toEqual(undoSnapshot);
    expect(conflictCardParams?.allowForceOverwrite).toBe(true);
    expect(conflictCardParams?.text).toContain('Safe Undo (Manual Edit Preserved)');
  });

  it('executes forceOverwrite rollback when mode === FORCE_ROLLBACK_AUTO_SYNC and sends confirmation notice', async () => {
    let passedOptions: any = null;
    let sentStatusNotice: any = null;

    (processor as any).hubspotV4Sync = {
      rollbackSyncIdempotently: async (_t: string, _s: any, opts: any) => {
        passedOptions = opts;
        return {
          dealAction: 'FORCE_OVERWRITTEN',
          conflictingFields: ['dealstage'],
          noteDeleted: true,
          taskDeleted: true,
        };
      },
    };

    (processor as any).whatsappApproval = {
      sendUndoStatusNotice: async (params: any) => {
        sentStatusNotice = params;
      },
    };

    const undoSnapshot = {
      tenantId: 'tenant_acme',
      runId: 'run_occ_02',
      repPhone: '+201001234567',
      hubspotPortalId: '14429103',
      dealId: 'deal_500',
      dealName: 'Acme Cloud Deal',
      createdNewDeal: false,
      previousDealStage: 'qualifiedtobuy',
      previousAmount: 20000,
      syncedDealLastModifiedMs: 1762540000000,
      committedDealStage: 'contractsent',
      committedAmount: 35000,
      noteId: 'note_1',
      taskId: 'task_1',
      receiptWhatsappMessageId: 'wamid.receipt_500',
    };

    const result = await processor.process({
      id: 'job_force_1',
      data: {
        tenantId: 'tenant_acme',
        runId: 'run_occ_02',
        mode: 'FORCE_ROLLBACK_AUTO_SYNC',
        undoSnapshot,
      },
    } as any);

    expect(result.status).toBe('rolled_back_successfully');
    expect(passedOptions).toEqual({ forceOverwrite: true });
    expect(sentStatusNotice?.text).toContain('Force Overwrite Applied');
  });

  it('pauses run in WAITING_APPROVAL when confidenceScore <= autoSyncThreshold and completes when approved: false', async () => {
    let approvalPromptSent = false;
    (processor as any).transcribeAndMergeBatch = async () => ({
      senderPhone: '+201005556677',
      messageCount: 1,
      totalAudioSeconds: 0,
      mergedTranscript: 'Maybe next quarter.',
    });
    (processor as any).resolveHubSpotEntities = async () => ({
      contactId: 'c_1',
      contactName: 'Karim',
      companyName: 'Beta',
      activeDealId: 'd_1',
      currentDealName: 'Beta Deal',
      currentDealStage: 'qualifiedtobuy',
      currentAmount: 15000,
    });
    (processor as any).extractCrmTransitionWithZod = async () => ({
      dealName: 'Beta Deal',
      dealStage: 'presentationscheduled',
      amount: 15000,
      currency: 'USD',
      expectedCloseDateIso: null,
      summaryNote: 'Tentative interest.',
      meddic: {
        metrics: null,
        economicBuyer: null,
        decisionCriteria: null,
        decisionProcess: null,
        identifiedPain: null,
        champion: null,
      },
      nextTask: null,
      competitorMentioned: null,
      confidenceScore: 70, // <= 85 threshold -> must pause for rep approval
      confidenceReasoning: 'Vague timeline.',
    });
    (processor as any).sendInteractiveApprovalPrompt = async () => {
      approvalPromptSent = true;
      return { whatsappMessageId: 'wamid.prompt_1' };
    };

    const pausedRes = await processor.process({
      id: 'job_low_conf',
      data: {
        tenantId: 'tenant_acme',
        runId: 'run_low_conf_1',
        mode: 'INITIAL_INGEST',
      },
    } as any);

    expect(pausedRes).toEqual({
      status: 'paused_waiting_for_approval',
      runId: 'run_low_conf_1',
    });
    expect(approvalPromptSent).toBe(true);

    // Rep clicks Reject -> approved: false
    const rejectedRes = await processor.process({
      id: 'job_reject_1',
      data: {
        tenantId: 'tenant_acme',
        runId: 'run_low_conf_1',
        mode: 'RESUME_AFTER_APPROVAL',
        approved: false,
      },
    } as any);

    expect(rejectedRes).toEqual({
      status: 'rejected_by_rep',
      runId: 'run_low_conf_1',
    });
  });

  it('auto-syncs to HubSpot and dispatches 1-line receipt when confidenceScore > autoSyncThreshold', async () => {
    let receiptDispatched = false;
    (processor as any).transcribeAndMergeBatch = async () => ({
      senderPhone: '+201005556677',
      messageCount: 1,
      totalAudioSeconds: 10,
      mergedTranscript: 'Send the contract for $60k.',
    });
    (processor as any).resolveHubSpotEntities = async () => ({
      contactId: 'c_1',
      contactName: 'Karim',
      companyName: 'Beta',
      activeDealId: 'd_1',
      currentDealName: 'Beta Deal',
      currentDealStage: 'qualifiedtobuy',
      currentAmount: 50000,
    });
    (processor as any).extractCrmTransitionWithZod = async () => ({
      dealName: 'Beta Deal',
      dealStage: 'contractsent',
      amount: 60000,
      currency: 'USD',
      expectedCloseDateIso: '2026-12-01',
      summaryNote: 'Confirmed $60k contract.',
      meddic: {
        metrics: null,
        economicBuyer: 'Karim',
        decisionCriteria: null,
        decisionProcess: null,
        identifiedPain: null,
        champion: 'Karim',
      },
      nextTask: null,
      competitorMentioned: null,
      confidenceScore: 95, // > 85 threshold -> AUTO_SYNC
      confidenceReasoning: 'Explicit contract request.',
    });
    (processor as any).syncToHubSpotV4 = async () => ({
      dealId: 'd_1',
      contactId: 'c_1',
      noteId: 'n_1',
      taskId: null,
      createdNewDeal: false,
      syncedDealLastModifiedMs: 1762540000000,
      committedDealStage: 'contractsent',
      committedAmount: 60000,
    });
    (processor as any).usageMeter = {
      recordLlmUsage: async () => {},
    };
    (processor as any).dispatchCompletionReceipt = async () => {
      receiptDispatched = true;
      return { receiptMessageId: 'wamid.receipt_auto_1' };
    };

    const syncedRes = await processor.process({
      id: 'job_high_conf',
      data: {
        tenantId: 'tenant_acme',
        runId: 'run_high_conf_1',
        mode: 'INITIAL_INGEST',
      },
    } as any);

    expect(syncedRes.status).toBe('completed');
    expect(receiptDispatched).toBe(true);
  });

  it('moves run to DEAD_LETTER on permanent OAuth revocation and delays job on HubSpot 429 rate limit', async () => {
    let lastRunUpdate: any = null;
    mockPrisma.workflowRun.updateMany = async ({ data }: any) => {
      lastRunUpdate = data;
      return { count: 1 };
    };

    (processor as any).transcribeAndMergeBatch = async () => {
      const revokedErr: any = new Error('Refresh token revoked');
      revokedErr.isPermanentOAuthError = true;
      throw revokedErr;
    };

    await expect(
      processor.process({
        id: 'job_oauth_dead',
        data: {
          tenantId: 'tenant_acme',
          runId: 'run_oauth_dead',
          mode: 'INITIAL_INGEST',
        },
      } as any),
    ).rejects.toThrow(/Refresh token revoked/);

    expect(lastRunUpdate?.status).toBe(RunStatus.DEAD_LETTER);

    // Rate limit backpressure: moves job to delayed without burning BullMQ retry attempt
    let delayedUntil = 0;
    (processor as any).transcribeAndMergeBatch = async () => {
      const rateErr: any = new Error('HubSpot 429');
      rateErr.isRateLimitError = true;
      rateErr.retryAfterMs = 10_000;
      rateErr.telemetry = { kind: 'BURST_10S', remainingBurst: 0 };
      throw rateErr;
    };

    await expect(
      processor.process(
        {
          id: 'job_rate_limit',
          data: {
            tenantId: 'tenant_acme',
            runId: 'run_rate_limit',
            mode: 'INITIAL_INGEST',
          },
          moveToDelayed: async (ts: number) => {
            delayedUntil = ts;
          },
        } as any,
        'token_xyz',
      ),
    ).rejects.toThrow();

    expect(delayedUntil > Date.now()).toBe(true);
  });
});

