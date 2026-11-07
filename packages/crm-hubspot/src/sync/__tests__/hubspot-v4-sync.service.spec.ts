import { HubSpotV4SyncService } from '../hubspot-v4-sync.service';
import { HubSpotUndoSnapshot } from '../../approval/whatsapp-approval.service';

describe('HubSpotV4SyncService (Idempotent v4 Sync & Two-Phase OCC Rollback)', () => {
  const baseWatermarkMs = 1762540000000; // 2025-11-07T18:26:40.000Z

  const baseSnapshot: HubSpotUndoSnapshot = {
    tenantId: 'tenant_01',
    runId: 'run_555',
    repPhone: '+201001234567',
    hubspotPortalId: '889900',
    dealId: 'deal_700',
    dealName: 'Vexel Enterprise License',
    createdNewDeal: false,
    previousDealStage: 'presentationscheduled',
    previousAmount: 15000,
    syncedDealLastModifiedMs: baseWatermarkMs,
    committedDealStage: 'contractsent',
    committedAmount: 30000,
    noteId: 'note_800',
    taskId: 'task_900',
    receiptWhatsappMessageId: 'wamid.receipt_01',
  };

  it('captures post-association watermark in syncTransitionIdempotently', async () => {
    const requests: Array<{ path: string; method: string; body?: any }> = [];
    const mockHttp: any = {
      request: async (req: { path: string; method: string; body?: any }) => {
        requests.push(req);
        if (req.path === '/crm/v3/objects/deals/deal_700' && req.method === 'PATCH') {
          return { status: 200, data: { id: 'deal_700' } };
        }
        if (req.path.includes('/associations/')) {
          return { status: 200, data: {} };
        }
        if (req.path === '/crm/v3/objects/notes/search') {
          return { status: 200, data: { results: [] } };
        }
        if (req.path === '/crm/v3/objects/notes' && req.method === 'POST') {
          return { status: 201, data: { id: 'note_800' } };
        }
        if (req.path === '/crm/v3/objects/tasks/search') {
          return { status: 200, data: { results: [] } };
        }
        if (req.path === '/crm/v3/objects/tasks' && req.method === 'POST') {
          return { status: 201, data: { id: 'task_900' } };
        }
        if (req.path.startsWith('/crm/v3/objects/deals/deal_700?properties=')) {
          return {
            status: 200,
            data: {
              id: 'deal_700',
              updatedAt: new Date(baseWatermarkMs).toISOString(),
              properties: {
                dealstage: 'contractsent',
                amount: '30000',
                hs_lastmodifieddate: new Date(baseWatermarkMs).toISOString(),
              },
            },
          };
        }
        return { status: 200, data: {} };
      },
    };

    const syncService = new HubSpotV4SyncService(mockHttp);
    const outcome = await syncService.syncTransitionIdempotently({
      tenantId: 'tenant_01',
      runId: 'run_555',
      senderPhone: '+201009998887',
      crmContext: {
        contactId: 'contact_100',
        contactName: 'Omar Hassan',
        contactOwnerId: 'owner_42',
        companyId: 'comp_200',
        companyName: 'Nile Fintech',
        activeDealId: 'deal_700',
        currentDealName: 'Vexel Enterprise License',
        currentDealStage: 'presentationscheduled',
        currentAmount: 15000,
        pipelineId: 'default',
      },
      payload: {
        dealName: 'Vexel Enterprise License',
        dealStage: 'contractsent',
        amount: 30000,
        currency: 'USD',
        expectedCloseDateIso: '2026-11-30',
        summaryNote: 'Confirmed contract terms on WhatsApp.',
        meddic: {
          metrics: 'Save 6h/week per AE',
          economicBuyer: 'Omar Hassan (VP Sales)',
          decisionCriteria: 'SOC2 + Arabic voice accuracy',
          decisionProcess: 'Legal review this week',
          identifiedPain: 'Manual HubSpot updates',
          champion: 'Omar Hassan',
        },
        nextTask: {
          title: 'Follow up on redlines',
          dueInHours: 24,
          priority: 'HIGH',
        },
        detectedLanguage: 'en',
        confidenceScore: 95,
        confidenceReasoning: 'Explicit verbal confirmation of stage and price.',
      },
    });

    expect(outcome).toEqual({
      dealId: 'deal_700',
      contactId: 'contact_100',
      noteId: 'note_800',
      taskId: 'task_900',
      createdNewDeal: false,
      syncedDealLastModifiedMs: baseWatermarkMs,
      committedDealStage: 'contractsent',
      committedAmount: 30000,
    });
  });

  it('restores prior dealstage and amount when within 3s association grace window (no manual UI edits)', async () => {
    let patchedDealBody: any = null;
    const mockHttp: any = {
      request: async (req: { path: string; method: string; body?: any }) => {
        if (req.method === 'DELETE') {
          return { status: 204, data: {} };
        }
        if (req.method === 'GET' && req.path.includes('propertiesWithHistory')) {
          return {
            status: 200,
            data: {
              id: 'deal_700',
              // 1.5s bump from HubSpot async note association indexer (within 3s grace window)
              updatedAt: new Date(baseWatermarkMs + 1500).toISOString(),
              properties: {
                dealstage: 'contractsent',
                amount: '30000',
                hs_lastmodifieddate: new Date(baseWatermarkMs + 1500).toISOString(),
              },
              propertiesWithHistory: {
                dealstage: [
                  {
                    value: 'contractsent',
                    timestamp: new Date(baseWatermarkMs).toISOString(),
                    sourceType: 'INTEGRATION',
                  },
                ],
                amount: [
                  {
                    value: '30000',
                    timestamp: new Date(baseWatermarkMs).toISOString(),
                    sourceType: 'INTEGRATION',
                  },
                ],
              },
            },
          };
        }
        if (req.method === 'PATCH' && req.path === '/crm/v3/objects/deals/deal_700') {
          patchedDealBody = req.body;
          return { status: 200, data: { id: 'deal_700' } };
        }
        return { status: 200, data: {} };
      },
    };

    const syncService = new HubSpotV4SyncService(mockHttp);
    const result = await syncService.rollbackSyncIdempotently('tenant_01', baseSnapshot);

    expect(result).toEqual({
      dealAction: 'RESTORED_PREVIOUS_STATE',
      conflictingFields: [],
      lastModifiedBySource: undefined,
      noteDeleted: true,
      taskDeleted: true,
    });
    expect(patchedDealBody).toEqual({
      properties: {
        dealstage: 'presentationscheduled',
        amount: 15000,
      },
    });
  });

  it('performs partial restore when rep manually edited dealstage in HubSpot CRM_UI', async () => {
    let patchedDealBody: any = null;
    const mockHttp: any = {
      request: async (req: { path: string; method: string; body?: any }) => {
        if (req.method === 'DELETE') return { status: 204, data: {} };
        if (req.method === 'GET' && req.path.includes('propertiesWithHistory')) {
          return {
            status: 200,
            data: {
              id: 'deal_700',
              updatedAt: new Date(baseWatermarkMs + 60_000).toISOString(),
              properties: {
                dealstage: 'closedwon', // Manually moved to Closed Won in HubSpot UI!
                amount: '30000', // Untouched since Vexel commit
                hs_lastmodifieddate: new Date(baseWatermarkMs + 60_000).toISOString(),
              },
              propertiesWithHistory: {
                dealstage: [
                  {
                    value: 'closedwon',
                    timestamp: new Date(baseWatermarkMs + 60_000).toISOString(),
                    sourceType: 'CRM_UI',
                  },
                ],
                amount: [
                  {
                    value: '30000',
                    timestamp: new Date(baseWatermarkMs).toISOString(),
                    sourceType: 'INTEGRATION',
                  },
                ],
              },
            },
          };
        }
        if (req.method === 'PATCH') {
          patchedDealBody = req.body;
          return { status: 200, data: { id: 'deal_700' } };
        }
        return { status: 200, data: {} };
      },
    };

    const syncService = new HubSpotV4SyncService(mockHttp);
    const result = await syncService.rollbackSyncIdempotently('tenant_01', baseSnapshot);

    expect(result).toEqual({
      dealAction: 'PARTIAL_RESTORE_SKIPPED_EDITED_FIELDS',
      conflictingFields: ['dealstage'],
      lastModifiedBySource: 'CRM_UI',
      noteDeleted: true,
      taskDeleted: true,
    });
    // Only amount is reverted; dealstage is preserved as 'closedwon'
    expect(patchedDealBody).toEqual({
      properties: {
        amount: 15000,
      },
    });
  });

  it('blocks Deal DELETE on net-new Deal if human edited it in HubSpot UI, unless forceOverwrite is true', async () => {
    let dealDeleteCalled = false;
    const mockHttp: any = {
      request: async (req: { path: string; method: string; body?: any }) => {
        if (req.method === 'DELETE' && req.path.includes('/deals/')) {
          dealDeleteCalled = true;
          return { status: 204, data: {} };
        }
        if (req.method === 'DELETE') {
          return { status: 204, data: {} };
        }
        if (req.method === 'GET' && req.path.includes('propertiesWithHistory')) {
          return {
            status: 200,
            data: {
              id: 'deal_700',
              updatedAt: new Date(baseWatermarkMs + 120_000).toISOString(),
              properties: {
                dealstage: 'qualifiedtobuy',
                amount: '55000',
                hs_lastmodifieddate: new Date(baseWatermarkMs + 120_000).toISOString(),
              },
              propertiesWithHistory: {
                amount: [
                  {
                    value: '55000',
                    timestamp: new Date(baseWatermarkMs + 120_000).toISOString(),
                    sourceType: 'CRM_UI',
                  },
                ],
              },
            },
          };
        }
        return { status: 200, data: {} };
      },
    };

    const syncService = new HubSpotV4SyncService(mockHttp);
    const newDealSnapshot: HubSpotUndoSnapshot = {
      ...baseSnapshot,
      createdNewDeal: true,
    };

    // 1. Standard Undo preserves the manually edited new Deal
    const safeResult = await syncService.rollbackSyncIdempotently('tenant_01', newDealSnapshot);
    expect(safeResult.dealAction).toBe('CONFLICT_PRESERVED_MANUAL_EDIT');
    expect(safeResult.conflictingFields).toContain('amount');
    expect(dealDeleteCalled).toBe(false);

    // 2. Force Overwrite archives the Deal despite the manual UI edit
    const forcedResult = await syncService.rollbackSyncIdempotently('tenant_01', newDealSnapshot, {
      forceOverwrite: true,
    });
    expect(forcedResult.dealAction).toBe('FORCE_OVERWRITTEN');
    expect(dealDeleteCalled).toBe(true);
  });
});
