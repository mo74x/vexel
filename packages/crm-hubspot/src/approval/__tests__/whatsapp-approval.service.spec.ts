import {
  WhatsAppApprovalService,
  HubSpotUndoSnapshot,
  PendingApprovalPointer,
} from '../whatsapp-approval.service';

describe('WhatsAppApprovalService', () => {
  let store: Map<string, string>;
  let mockRedis: any;
  let service: WhatsAppApprovalService;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.VEXEL_APPROVAL_HMAC_SECRET = 'test_hmac_secret_2026';
    store = new Map<string, string>();

    mockRedis = {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, val: string) => {
        store.set(key, val);
        return 'OK';
      },
      del: async (...keys: string[]) => {
        let count = 0;
        for (const k of keys) {
          if (store.delete(k)) count++;
        }
        return count;
      },
      getdel: async (key: string) => {
        const val = store.get(key) ?? null;
        store.delete(key);
        return val;
      },
      pipeline: () => {
        const ops: Array<() => void> = [];
        return {
          set: (key: string, val: string) => {
            ops.push(() => store.set(key, val));
            return this;
          },
          exec: async () => {
            ops.forEach((fn) => fn());
            return [];
          },
        };
      },
    };

    service = new WhatsAppApprovalService(mockRedis);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('verifyAndParseButtonReply (HMAC verification)', () => {
    it('verifies valid HMAC signatures for approve, reject, undo, and force_undo actions', () => {
      const actions: Array<'approve' | 'reject' | 'undo' | 'force_undo'> = [
        'approve',
        'reject',
        'undo',
        'force_undo',
      ];

      for (const action of actions) {
        const signed = (service as any).signButtonPayload(action, 'tenant_1', 'run_99');
        const parsed = service.verifyAndParseButtonReply(signed);

        expect(parsed).toEqual({
          action,
          tenantId: 'tenant_1',
          runId: 'run_99',
        });
      }
    });

    it('throws on tampered HMAC signature or payload substitution', () => {
      const signed = (service as any).signButtonPayload('approve', 'tenant_1', 'run_99');
      const tampered = signed.replace('tenant_1', 'tenant_2');

      expect(() => service.verifyAndParseButtonReply(tampered)).toThrow(
        /Invalid HMAC signature/,
      );
    });

    it('returns null on malformed button IDs or unsupported actions', () => {
      expect(service.verifyAndParseButtonReply('invalid_payload')).toBeNull();
      expect(service.verifyAndParseButtonReply('vexel_act:unknown:t1:r1:0123456789abcdef')).toBeNull();
    });
  });

  describe('Pending Approval Session Correlation', () => {
    const pointer: PendingApprovalPointer = {
      tenantId: 'tenant_acme',
      runId: 'run_abc123',
      repPhone: '+20 (100) 123-4567',
      whatsappMessageId: 'wamid.HBgLMjAxMDAxMjM0NTY3',
    };

    it('correlates swipe-to-reply by exact wamid and falls back to normalized rep phone', async () => {
      await service.registerPendingApprovalSession(pointer);

      // 1. Exact quoted wamid match (even if sender phone formatting differs)
      const byQuote = await service.resolveRepOverrideTarget(
        'tenant_acme',
        '+20999999999',
        'wamid.HBgLMjAxMDAxMjM0NTY3',
      );
      expect(byQuote).toEqual(pointer);

      // 2. Unquoted direct reply match by normalized digits
      const byPhone = await service.resolveRepOverrideTarget(
        'tenant_acme',
        '201001234567',
      );
      expect(byPhone).toEqual(pointer);

      // 3. Consume session clears both keys atomically
      await service.consumeApprovalSession(pointer);
      const afterConsume = await service.resolveRepOverrideTarget(
        'tenant_acme',
        '201001234567',
        'wamid.HBgLMjAxMDAxMjM0NTY3',
      );
      expect(afterConsume).toBeNull();
    });
  });

  describe('15-Minute Undo & Force-Undo Snapshots (Atomic GETDEL)', () => {
    const baseSnapshot: Omit<HubSpotUndoSnapshot, 'receiptWhatsappMessageId'> = {
      tenantId: 'tenant_acme',
      runId: 'run_undo_01',
      repPhone: '+971501234567',
      hubspotPortalId: '14429103',
      dealId: '987654321',
      dealName: 'Acme Enterprise Expansion',
      createdNewDeal: false,
      previousDealStage: 'qualifiedtobuy',
      previousAmount: 25000,
      syncedDealLastModifiedMs: 1762540000000,
      committedDealStage: 'contractsent',
      committedAmount: 40000,
      noteId: 'note_11',
      taskId: 'task_22',
    };

    it('renders an interactive [↩️ Undo Sync (15m)] button on AUTO_SYNC and pops snapshot once via GETDEL', async () => {
      let capturedBody: any = null;
      globalThis.fetch = (async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'wamid.receipt_900' }] }),
        } as any;
      }) as any;

      const res = await service.sendSyncConfirmationReceipt({
        tenantId: 'tenant_acme',
        runId: 'run_undo_01',
        whatsappPhoneNumberId: 'phone_id_1',
        whatsappAccessToken: 'token_xyz',
        repDestinationPhone: '+971501234567',
        hubspotPortalId: '14429103',
        dealId: '987654321',
        dealName: 'Acme Enterprise Expansion',
        stageLabel: 'Contract Sent',
        amount: 40000,
        currency: 'USD',
        syncMode: 'AUTO_SYNC',
        undoSnapshot: baseSnapshot,
      });

      expect(res.receiptMessageId).toBe('wamid.receipt_900');
      expect(capturedBody.type).toBe('interactive');
      expect(capturedBody.interactive.action.buttons[0].reply.title).toBe('↩️ Undo Sync (15m)');
      expect(capturedBody.interactive.body.text).toContain(
        'https://app.hubspot.com/contacts/14429103/record/0-3/987654321',
      );

      // First GETDEL succeeds and includes receiptWhatsappMessageId
      const firstPop = await service.consumeUndoSnapshot('tenant_acme', 'run_undo_01');
      expect(firstPop).toEqual({
        ...baseSnapshot,
        receiptWhatsappMessageId: 'wamid.receipt_900',
      });

      // Second GETDEL (double-tap race) returns null
      const secondPop = await service.consumeUndoSnapshot('tenant_acme', 'run_undo_01');
      expect(secondPop).toBeNull();
    });

    it('arms force-undo snapshot on OCC conflict and dispatches [⚠️ Force Overwrite] button', async () => {
      let capturedBody: any = null;
      globalThis.fetch = (async (_url: any, init: any) => {
        capturedBody = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ messages: [{ id: 'wamid.conflict_01' }] }),
        } as any;
      }) as any;

      const snapshotWithReceipt: HubSpotUndoSnapshot = {
        ...baseSnapshot,
        receiptWhatsappMessageId: 'wamid.receipt_900',
      };

      await service.armForceUndoSnapshot(snapshotWithReceipt);
      await service.sendUndoConflictNotice({
        tenantId: 'tenant_acme',
        runId: 'run_undo_01',
        whatsappPhoneNumberId: 'phone_id_1',
        whatsappAccessToken: 'token_xyz',
        repDestinationPhone: '+971501234567',
        replyToMessageId: 'wamid.receipt_900',
        text: '🛡️ *Safe Undo (Manual Edit Preserved)*',
        allowForceOverwrite: true,
      });

      expect(capturedBody.type).toBe('interactive');
      expect(capturedBody.context.message_id).toBe('wamid.receipt_900');
      const btn = capturedBody.interactive.action.buttons[0].reply;
      expect(btn.title).toBe('⚠️ Force Overwrite');

      const verifiedBtn = service.verifyAndParseButtonReply(btn.id);
      expect(verifiedBtn).toEqual({
        action: 'force_undo',
        tenantId: 'tenant_acme',
        runId: 'run_undo_01',
      });

      const poppedForce = await service.consumeForceUndoSnapshot('tenant_acme', 'run_undo_01');
      expect(poppedForce).toEqual(snapshotWithReceipt);
      expect(await service.consumeForceUndoSnapshot('tenant_acme', 'run_undo_01')).toBeNull();
    });
  });
});

