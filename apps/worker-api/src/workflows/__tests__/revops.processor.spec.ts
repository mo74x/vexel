import { RevOpsWorkflowProcessor, computeOverriddenFieldsDiff } from '../revops.processor';
import { RunOutcome, RunStatus } from '@prisma/client';

describe('RevOpsWorkflowProcessor', () => {
  let mockPrisma: any;
  let mockLockService: any;
  let processor: RevOpsWorkflowProcessor;
  let runUpdates: Array<{ where: any; data: any }>;
  let auditLogsCreated: any[];
  let mockReps: any[];
  let mockUsers: Record<string, any>;

  beforeEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'wa_phone_100';
    process.env.WHATSAPP_SYSTEM_TOKEN = 'wa_sys_token';
    process.env.DEFAULT_REP_APPROVAL_PHONE = '+201000000001';
    process.env.VEXEL_KEK_V1 =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.OPENAI_API_KEY = 'sk-test-openai-key';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';

    const stepStore = new Map<string, any>();
    runUpdates = [];
    auditLogsCreated = [];
    mockReps = [
      {
        id: 'rep_sara_1',
        tenantId: 'tenant_acme',
        hubspotOwnerId: 'owner_77',
        email: 'sara@acme.io',
        fullName: 'Sara Hassan',
        whatsappPhone: '+201001234567',
        isActive: true,
      },
    ];
    mockUsers = {
      'sara@acme.io': {
        id: 'user_sara_99',
        email: 'sara@acme.io',
        name: 'Sara Hassan',
        locale: 'en',
        isOperator: false,
      },
    };

    const tenantRepMock = {
      findUnique: async ({ where }: any) => {
        if (where?.id) return mockReps.find((r) => r.id === where.id) ?? null;
        if (where?.tenantId_hubspotOwnerId) {
          return (
            mockReps.find(
              (r) =>
                r.tenantId === where.tenantId_hubspotOwnerId.tenantId &&
                r.hubspotOwnerId === where.tenantId_hubspotOwnerId.hubspotOwnerId,
            ) ?? null
          );
        }
        return null;
      },
      findFirst: async ({ where }: any) => {
        const candidates: string[] = where?.whatsappPhone?.in ?? [];
        return mockReps.find((r) => candidates.includes(r.whatsappPhone)) ?? null;
      },
    };

    const userMock = {
      findUnique: async ({ where }: any) => {
        if (where?.email) return mockUsers[where.email] ?? null;
        return null;
      },
    };

    const auditLogMock = {
      create: async ({ data }: any) => {
        auditLogsCreated.push(data);
        return { id: `aud_${auditLogsCreated.length}`, ...data };
      },
    };

    mockPrisma = {
      client: {
        tenant: {
          findUnique: async () => ({
            id: 'tenant_acme',
            whatsappAccessToken: null,
          }),
        },
        tenantRep: tenantRepMock,
        user: userMock,
        auditLog: auditLogMock,
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
              update: async ({ where, data }: any) => {
                runUpdates.push({ where, data });
                return {};
              },
            },
            auditLog: auditLogMock,
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
      tenantRep: tenantRepMock,
      user: userMock,
      auditLog: auditLogMock,
      workflowRun: {
        update: async ({ where, data }: any) => {
          runUpdates.push({ where, data });
          return {
            id: where.id,
            status: data.status ?? RunStatus.RUNNING,
            inputPayload: { senderPhone: '+201005556677', messages: [] },
          };
        },
        updateMany: async ({ where, data }: any) => {
          runUpdates.push({ where, data });
          return data;
        },
      },
      $withTenantTransaction: async (cb: any) =>
        cb({
          workflowStep: {
            upsert: async () => ({}),
          },
          workflowRun: {
            update: async ({ where, data }: any) => {
              runUpdates.push({ where, data });
              return {};
            },
          },
          auditLog: auditLogMock,
        }),
      workflowStep: {
        findUnique: async ({ where }: any) => {
          const key = `${where.runId_stepKey.runId}:${where.runId_stepKey.stepKey}`;
          return stepStore.get(key) ?? null;
        },
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

    const finalUpdate = runUpdates.find((u) => u.data.status === RunStatus.COMPLETED);
    expect(finalUpdate?.data.outcome).toBe(RunOutcome.AUTO_SYNCED);
    expect(auditLogsCreated.length).toBe(0);
  });

  it('sets outcome = APPROVED_AS_IS, decidedByRepId, decidedAt, and writes AuditLog when rep approves without changes', async () => {
    const baseExtraction = {
      dealName: 'Beta Deal',
      dealStage: 'presentationscheduled',
      amount: 15000,
      currency: 'USD',
      expectedCloseDateIso: null,
      summaryNote: 'Confirmed demo.',
      meddic: {
        metrics: null,
        economicBuyer: null,
        decisionCriteria: null,
        decisionProcess: null,
        identifiedPain: null,
        champion: null,
      },
      nextTask: null,
      detectedLanguage: 'en',
      confidenceScore: 70,
      confidenceReasoning: 'Needs confirmation.',
    };

    (processor as any).transcribeAndMergeBatch = async () => ({
      senderPhone: '+201005556677',
      messageCount: 1,
      totalAudioSeconds: 0,
      mergedTranscript: 'Schedule presentation.',
    });
    (processor as any).resolveHubSpotEntities = async () => ({
      contactId: 'c_1',
      contactName: 'Karim',
      contactOwnerId: 'owner_77',
      companyName: 'Beta',
      activeDealId: 'd_1',
      currentDealName: 'Beta Deal',
      currentDealStage: 'qualifiedtobuy',
      currentAmount: 15000,
    });
    (processor as any).extractCrmTransitionWithZod = async () => baseExtraction;
    (processor as any).syncToHubSpotV4 = async () => ({
      dealId: 'd_1',
      contactId: 'c_1',
      noteId: 'n_1',
      taskId: null,
      createdNewDeal: false,
      syncedDealLastModifiedMs: 1762540000000,
      committedDealStage: 'presentationscheduled',
      committedAmount: 15000,
    });
    (processor as any).usageMeter = { recordLlmUsage: async () => {} };
    (processor as any).dispatchCompletionReceipt = async () => ({
      receiptMessageId: 'wamid.receipt_approved_1',
    });

    const res = await processor.process({
      id: 'job_approve_as_is',
      data: {
        tenantId: 'tenant_acme',
        runId: 'run_approve_as_is',
        mode: 'RESUME_AFTER_APPROVAL',
        approved: true,
        repPhone: '201001234567',
      },
    } as any);

    expect(res.status).toBe('completed');
    const finalUpdate = runUpdates.find(
      (u) => u.where.id === 'run_approve_as_is' && u.data.status === RunStatus.COMPLETED,
    );
    expect(finalUpdate?.data.outcome).toBe(RunOutcome.APPROVED_AS_IS);
    expect(finalUpdate?.data.overriddenFields).toBeNull();
    expect(finalUpdate?.data.decidedByRepId).toBe('rep_sara_1');
    expect(finalUpdate?.data.decidedAt instanceof Date).toBe(true);

    expect(auditLogsCreated.length).toBe(1);
    expect(auditLogsCreated[0].tenantId).toBe('tenant_acme');
    expect(auditLogsCreated[0].actorUserId).toBe('user_sara_99');
    expect(auditLogsCreated[0].action).toBe('workflow_run.approved_as_is');
    expect(auditLogsCreated[0].targetType).toBe('WorkflowRun');
    expect(auditLogsCreated[0].targetId).toBe('run_approve_as_is');
    expect(auditLogsCreated[0].meta.outcome).toBe(RunOutcome.APPROVED_AS_IS);
    expect(auditLogsCreated[0].meta.decidedByRepId).toBe('rep_sara_1');
    expect(auditLogsCreated[0].meta.overriddenFields).toBeNull();
  });

  it('sets outcome = APPROVED_WITH_OVERRIDE, stores overriddenFields diff, and writes AuditLog when rep overrides fields', async () => {
    // Test when rep has no matching User row yet -> actorUserId = null, rep metadata preserved
    mockUsers = {};

    const baseExtraction = {
      dealName: 'Beta Deal',
      dealStage: 'presentationscheduled',
      amount: 15000,
      currency: 'USD',
      expectedCloseDateIso: null,
      summaryNote: 'Confirmed demo.',
      meddic: {
        metrics: null,
        economicBuyer: null,
        decisionCriteria: null,
        decisionProcess: null,
        identifiedPain: null,
        champion: null,
      },
      nextTask: null,
      detectedLanguage: 'en',
      confidenceScore: 70,
      confidenceReasoning: 'Needs confirmation.',
    };

    (processor as any).transcribeAndMergeBatch = async () => ({
      senderPhone: '+201005556677',
      messageCount: 1,
      totalAudioSeconds: 0,
      mergedTranscript: 'Schedule presentation.',
    });
    (processor as any).resolveHubSpotEntities = async () => ({
      contactId: 'c_1',
      contactName: 'Karim',
      contactOwnerId: 'owner_77',
      companyName: 'Beta',
      activeDealId: 'd_1',
      currentDealName: 'Beta Deal',
      currentDealStage: 'qualifiedtobuy',
      currentAmount: 15000,
      pipelineId: 'default',
    });
    (processor as any).extractCrmTransitionWithZod = async () => baseExtraction;
    (processor as any).stageCache = {
      getTenantStages: async () => [
        { id: 'presentationscheduled', label: 'Presentation Scheduled', displayOrder: 0, probability: 0.4 },
        { id: 'contractsent', label: 'Contract Sent', displayOrder: 1, probability: 0.8 },
      ],
    };
    (processor as any).repOverrideParser = {
      parseRepTextOverride: async () => ({
        mergedPayload: {
          ...baseExtraction,
          amount: 42000,
          dealStage: 'contractsent',
          confidenceScore: 100,
        },
        editedPatch: { amount: 42000, dealStage: 'contractsent', confidenceScore: 100 },
        parserTier: 'DETERMINISTIC_REGEX',
        action: 'APPROVE_WITH_PATCH',
      }),
    };
    (processor as any).syncToHubSpotV4 = async () => ({
      dealId: 'd_1',
      contactId: 'c_1',
      noteId: 'n_1',
      taskId: null,
      createdNewDeal: false,
      syncedDealLastModifiedMs: 1762540000000,
      committedDealStage: 'contractsent',
      committedAmount: 42000,
    });
    (processor as any).usageMeter = { recordLlmUsage: async () => {} };
    (processor as any).dispatchCompletionReceipt = async () => ({
      receiptMessageId: 'wamid.receipt_override_1',
    });

    const res = await processor.process({
      id: 'job_approve_override',
      data: {
        tenantId: 'tenant_acme',
        runId: 'run_approve_override',
        mode: 'RESUME_AFTER_APPROVAL',
        approved: true,
        rawRepOverrideText: 'amount 42k stage contractsent',
      },
    } as any);

    expect(res.status).toBe('completed');
    const finalUpdate = runUpdates.find(
      (u) => u.where.id === 'run_approve_override' && u.data.status === RunStatus.COMPLETED,
    );
    expect(finalUpdate?.data.outcome).toBe(RunOutcome.APPROVED_WITH_OVERRIDE);
    expect(finalUpdate?.data.overriddenFields).toEqual({
      amount: { from: 15000, to: 42000 },
      dealStage: { from: 'presentationscheduled', to: 'contractsent' },
    });
    expect(finalUpdate?.data.decidedByRepId).toBe('rep_sara_1');
    expect(finalUpdate?.data.decidedAt instanceof Date).toBe(true);

    expect(auditLogsCreated.length).toBe(1);
    expect(auditLogsCreated[0].tenantId).toBe('tenant_acme');
    expect(auditLogsCreated[0].actorUserId).toBeNull();
    expect(auditLogsCreated[0].action).toBe('workflow_run.approved_with_override');
    expect(auditLogsCreated[0].targetType).toBe('WorkflowRun');
    expect(auditLogsCreated[0].targetId).toBe('run_approve_override');
    expect(auditLogsCreated[0].meta.decidedByRepId).toBe('rep_sara_1');
    expect(auditLogsCreated[0].meta.repEmail).toBe('sara@acme.io');
    expect(auditLogsCreated[0].meta.overriddenFields).toEqual({
      amount: { from: 15000, to: 42000 },
      dealStage: { from: 'presentationscheduled', to: 'contractsent' },
    });
  });

  it('sets outcome = REJECTED and writes AuditLog when rep rejects via text reply ("reject")', async () => {
    (processor as any).transcribeAndMergeBatch = async () => ({
      senderPhone: '+201005556677',
      messageCount: 1,
      totalAudioSeconds: 0,
      mergedTranscript: 'Wrong contact.',
    });
    (processor as any).resolveHubSpotEntities = async () => ({
      contactId: 'c_1',
      contactName: 'Karim',
      contactOwnerId: 'owner_77',
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
      summaryNote: 'Wrong contact.',
      meddic: {
        metrics: null,
        economicBuyer: null,
        decisionCriteria: null,
        decisionProcess: null,
        identifiedPain: null,
        champion: null,
      },
      nextTask: null,
      detectedLanguage: 'en',
      confidenceScore: 60,
      confidenceReasoning: 'Low confidence.',
    });
    (processor as any).stageCache = {
      getTenantStages: async () => [],
    };
    (processor as any).repOverrideParser = {
      parseRepTextOverride: async () => ({
        mergedPayload: {},
        editedPatch: {},
        parserTier: 'DETERMINISTIC_REGEX',
        action: 'REJECT',
      }),
    };

    const res = await processor.process({
      id: 'job_reject_text',
      data: {
        tenantId: 'tenant_acme',
        runId: 'run_reject_text',
        mode: 'RESUME_AFTER_APPROVAL',
        approved: true,
        rawRepOverrideText: 'reject',
      },
    } as any);

    expect(res).toEqual({ status: 'rejected_by_rep_text', runId: 'run_reject_text' });
    const rejectUpdate = runUpdates.find(
      (u) => u.where.id === 'run_reject_text' && u.data.outcome === RunOutcome.REJECTED,
    );
    expect(rejectUpdate?.data.status).toBe(RunStatus.COMPLETED);
    expect(rejectUpdate?.data.decidedByRepId).toBe('rep_sara_1');
    expect(rejectUpdate?.data.decidedAt instanceof Date).toBe(true);
    expect(auditLogsCreated.at(-1)?.action).toBe('workflow_run.rejected');
    expect(auditLogsCreated.at(-1)?.targetId).toBe('run_reject_text');
    expect(auditLogsCreated.at(-1)?.actorUserId).toBe('user_sara_99');
  });

  it('sets outcome = UNDONE and undoneAt on partial restore, conflict-preserved, and force-overwrite rollbacks', async () => {
    (processor as any).hubspotV4Sync = {
      rollbackSyncIdempotently: async () => ({
        dealAction: 'PARTIAL_RESTORE_SKIPPED_EDITED_FIELDS',
        conflictingFields: ['amount'],
        lastModifiedBySource: 'CRM_UI',
        noteDeleted: true,
        taskDeleted: true,
      }),
    };
    (processor as any).whatsappApproval = {
      armForceUndoSnapshot: async () => {},
      sendUndoConflictNotice: async () => ({ messageId: 'wamid.partial_conflict' }),
    };

    const undoSnapshot = {
      tenantId: 'tenant_acme',
      runId: 'run_partial_undo',
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

    const res = await processor.process({
      id: 'job_partial_undo',
      data: {
        tenantId: 'tenant_acme',
        runId: 'run_partial_undo',
        mode: 'ROLLBACK_AUTO_SYNC',
        undoSnapshot,
      },
    } as any);

    expect(res.status).toBe('rolled_back_with_conflict');
    const undoUpdate = runUpdates.find(
      (u) => u.where.id === 'run_partial_undo' && u.data.outcome === RunOutcome.UNDONE,
    );
    expect(undoUpdate?.data.undoneAt instanceof Date).toBe(true);
    expect(auditLogsCreated.at(-1)?.action).toBe('workflow_run.undone');
    expect(auditLogsCreated.at(-1)?.targetId).toBe('run_partial_undo');
    expect(auditLogsCreated.at(-1)?.actorUserId).toBe('user_sara_99');
  });

  it('computes field-level { from, to } diffs while ignoring confidence metadata', () => {
    const diff = computeOverriddenFieldsDiff(
      {
        dealStage: 'qualifiedtobuy',
        amount: 10000,
        currency: 'USD',
        confidenceScore: 72,
        confidenceReasoning: 'Initial',
      },
      {
        dealStage: 'contractsent',
        amount: 10000,
        currency: 'USD',
        confidenceScore: 100,
        confidenceReasoning: 'Overridden',
      },
    );

    expect(diff).toEqual({
      dealStage: { from: 'qualifiedtobuy', to: 'contractsent' },
    });
  });

  it('moves run to DEAD_LETTER with outcome = FAILED on permanent OAuth revocation, marks FAILED on exhausted attempts, and delays job on HubSpot 429 rate limit', async () => {
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
    expect(lastRunUpdate?.outcome).toBe(RunOutcome.FAILED);

    // Exhausted BullMQ attempts -> status = FAILED, outcome = FAILED
    (processor as any).transcribeAndMergeBatch = async () => {
      throw new Error('Upstream Whisper outage');
    };

    await expect(
      processor.process({
        id: 'job_exhausted',
        attemptsMade: 4,
        opts: { attempts: 5 },
        data: {
          tenantId: 'tenant_acme',
          runId: 'run_exhausted',
          mode: 'INITIAL_INGEST',
        },
      } as any),
    ).rejects.toThrow(/Upstream Whisper outage/);

    expect(lastRunUpdate?.status).toBe(RunStatus.FAILED);
    expect(lastRunUpdate?.outcome).toBe(RunOutcome.FAILED);

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

