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
      },
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
});

