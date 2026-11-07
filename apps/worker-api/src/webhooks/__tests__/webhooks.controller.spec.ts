import { createHmac } from 'crypto';
import { WebhooksController } from '../webhooks.controller';

describe('WebhooksController', () => {
  let queuedJobs: Array<{ name: string; data: any; opts: any }>;
  let mockQueue: any;
  let mockLockService: any;
  let mockPrisma: any;
  let controller: WebhooksController;

  beforeEach(() => {
    process.env.WHATSAPP_PHONE_NUMBER_ID = 'wa_phone_100';
    process.env.WHATSAPP_SYSTEM_TOKEN = 'wa_sys_token';
    process.env.VEXEL_APPROVAL_HMAC_SECRET = 'test_hmac_secret';
    process.env.VEXEL_INTERNAL_API_KEY = 'internal_api_secret_123';
    process.env.META_WEBHOOK_VERIFY_TOKEN = 'meta_verify_token_abc';
    delete process.env.META_APP_SECRET;
    process.env.VEXEL_KEK_V1 =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    queuedJobs = [];
    mockQueue = {
      add: async (name: string, data: any, opts: any) => {
        queuedJobs.push({ name, data, opts });
        return { id: opts?.jobId ?? 'job_1' };
      },
      getJob: async () => null,
    };

    mockLockService = {
      redis: {},
      claimIdempotencyKey: async () => true,
      appendToBuffer: async () => 1,
    };

    mockPrisma = {
      client: {},
    };

    controller = new WebhooksController(mockPrisma, mockLockService, mockQueue);
  });

  it('intercepts conversational sales rep text replies to WAITING_APPROVAL cards, consumes session, and queues RESUME_AFTER_APPROVAL', async () => {
    let consumedPointer: any = null;
    (controller as any).whatsappApproval = {
      resolveRepOverrideTarget: async (
        tenantId: string,
        senderPhone: string,
        contextMessageId?: string,
      ) => ({
        tenantId,
        runId: 'run_paused_77',
        repPhone: senderPhone,
        whatsappMessageId: contextMessageId ?? 'wamid.card_77',
      }),
      consumeApprovalSession: async (ptr: any) => {
        consumedPointer = ptr;
      },
    };

    const webhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.reply_01',
                    from: '201001234567',
                    type: 'text',
                    text: { body: 'amount 42k stage contractsent' },
                    context: { id: 'wamid.card_77' },
                    timestamp: '1762540000',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const response = await controller.ingestOmnichannelEvent(
      'tenant_acme',
      'sha256=sig',
      webhookBody,
    );

    expect(response).toEqual({
      status: 'rep_text_override_queued',
      runId: 'run_paused_77',
    });
    expect(consumedPointer?.runId).toBe('run_paused_77');
    expect(queuedJobs.length).toBe(1);
    expect(queuedJobs[0].data).toEqual({
      tenantId: 'tenant_acme',
      runId: 'run_paused_77',
      mode: 'RESUME_AFTER_APPROVAL',
      approved: true,
      rawRepOverrideText: 'amount 42k stage contractsent',
    });
  });

  it('handles 15m Undo button click: queues ROLLBACK_AUTO_SYNC when snapshot is active or sends expiry notice when null', async () => {
    const mockSnapshot = {
      tenantId: 'tenant_acme',
      runId: 'run_auto_88',
      repPhone: '201001234567',
      dealId: 'deal_1',
    };

    let statusNoticeSent: any = null;
    let shouldReturnSnapshot = true;

    (controller as any).whatsappApproval = {
      verifyAndParseButtonReply: () => ({
        action: 'undo',
        tenantId: 'tenant_acme',
        runId: 'run_auto_88',
      }),
      consumeUndoSnapshot: async () => (shouldReturnSnapshot ? mockSnapshot : null),
      sendUndoStatusNotice: async (params: any) => {
        statusNoticeSent = params;
      },
    };

    const buttonWebhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.btn_undo',
                    from: '201001234567',
                    type: 'interactive',
                    interactive: {
                      button_reply: { id: 'vexel_act:undo:tenant_acme:run_auto_88:mac' },
                    },
                    context: { id: 'wamid.receipt_88' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    // 1. Active snapshot -> queues ROLLBACK_AUTO_SYNC
    const activeRes = await controller.ingestOmnichannelEvent(
      'tenant_acme',
      'sha256=sig',
      buttonWebhookBody,
    );
    expect(activeRes).toEqual({
      status: 'undo_rollback_queued',
      runId: 'run_auto_88',
    });
    expect(queuedJobs[0].data.mode).toBe('ROLLBACK_AUTO_SYNC');

    // 2. Expired snapshot -> sends immediate WhatsApp notice
    shouldReturnSnapshot = false;
    const expiredRes = await controller.ingestOmnichannelEvent(
      'tenant_acme',
      'sha256=sig',
      buttonWebhookBody,
    );
    expect(expiredRes).toEqual({
      status: 'undo_window_expired',
      runId: 'run_auto_88',
    });
    expect(statusNoticeSent?.text).toContain('Undo Window Expired');
  });

  it('handles Force Overwrite button click (force_undo) and queues FORCE_ROLLBACK_AUTO_SYNC', async () => {
    const mockSnapshot = {
      tenantId: 'tenant_acme',
      runId: 'run_conflict_99',
      repPhone: '201001234567',
      dealId: 'deal_99',
    };

    (controller as any).whatsappApproval = {
      verifyAndParseButtonReply: () => ({
        action: 'force_undo',
        tenantId: 'tenant_acme',
        runId: 'run_conflict_99',
      }),
      consumeForceUndoSnapshot: async () => mockSnapshot,
    };

    const forceWebhookBody = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.btn_force',
                    from: '201001234567',
                    type: 'interactive',
                    interactive: {
                      button_reply: {
                        id: 'vexel_act:force_undo:tenant_acme:run_conflict_99:mac',
                      },
                    },
                    context: { id: 'wamid.conflict_card_99' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await controller.ingestOmnichannelEvent(
      'tenant_acme',
      'sha256=sig',
      forceWebhookBody,
    );

    expect(res).toEqual({
      status: 'force_undo_rollback_queued',
      runId: 'run_conflict_99',
    });
    expect(queuedJobs[0].data).toEqual({
      tenantId: 'tenant_acme',
      runId: 'run_conflict_99',
      mode: 'FORCE_ROLLBACK_AUTO_SYNC',
      undoSnapshot: mockSnapshot,
    });
    expect(queuedJobs[0].opts.jobId).toBe('force-undo:run_conflict_99');
  });

  it('verifies Meta GET webhook challenge and rejects mismatched verify_token', () => {
    const challenge = controller.verifyWebhookChallenge(
      'tenant_acme',
      'subscribe',
      'meta_verify_token_abc',
      'challenge_987654',
    );
    expect(challenge).toBe('challenge_987654');

    expect(() =>
      controller.verifyWebhookChallenge(
        'tenant_acme',
        'subscribe',
        'wrong_token',
        'challenge_987654',
      ),
    ).toThrow(/verify_token mismatch/);
  });

  it('enforces X-Hub-Signature-256 HMAC-SHA256 verification when META_APP_SECRET is set', async () => {
    process.env.META_APP_SECRET = 'meta_secret_key_999';
    const rawPayload = JSON.stringify({ entry: [] });
    const rawBuffer = Buffer.from(rawPayload, 'utf8');
    const validSig = `sha256=${createHmac('sha256', 'meta_secret_key_999').update(rawBuffer).digest('hex')}`;

    const okRes = await controller.ingestOmnichannelEvent(
      'tenant_acme',
      validSig,
      { entry: [] },
      { rawBody: rawBuffer },
    );
    expect(okRes).toEqual({ status: 'ignored_non_message_event' });

    await expect(
      controller.ingestOmnichannelEvent(
        'tenant_acme',
        'sha256=0000000000000000000000000000000000000000000000000000000000000000',
        { entry: [] },
        { rawBody: rawBuffer },
      ),
    ).rejects.toThrow(/Invalid X-Hub-Signature-256/);
  });

  it('requires x-vexel-api-key on POST /v1/webhooks/approval-callback', async () => {
    await expect(
      controller.handleRepApproval(undefined, {
        tenantId: 'tenant_acme',
        runId: 'run_10',
        approved: true,
      }),
    ).rejects.toThrow(/Missing internal API key/);

    await expect(
      controller.handleRepApproval('wrong_key', {
        tenantId: 'tenant_acme',
        runId: 'run_10',
        approved: true,
      }),
    ).rejects.toThrow(/Invalid internal API key/);

    const ok = await controller.handleRepApproval('internal_api_secret_123', {
      tenantId: 'tenant_acme',
      runId: 'run_10',
      approved: true,
    });
    expect(ok).toEqual({ status: 'workflow_resumed', runId: 'run_10' });
    expect(queuedJobs[0].opts.removeOnComplete).toBe(true);
  });

  it('schedules a new generation debounce job when existing debounce job is currently active', async () => {
    (controller as any).whatsappApproval.resolveRepOverrideTarget = async () => null;
    mockQueue.getJob = async () => ({
      getState: async () => 'active',
    });

    const body = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  {
                    id: 'wamid.msg_during_active',
                    from: '201005556666',
                    type: 'text',
                    text: { body: 'Adding one more detail while batch is running' },
                    timestamp: '1762540100',
                  },
                ],
              },
            },
          ],
        },
      ],
    };

    const res = await controller.ingestOmnichannelEvent('tenant_acme', 'sha256=sig', body);
    expect(res.status).toBe('buffered_and_scheduled');
    expect((res as any).jobId).toMatch(/^debounce:tenant_acme:201005556666:\d+$/);
    expect(queuedJobs.length).toBe(1);
  });
});

