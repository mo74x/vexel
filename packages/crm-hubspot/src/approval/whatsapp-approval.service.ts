import { createHmac, timingSafeEqual } from 'crypto';
import Redis from 'ioredis';
import { CrmTransitionPayload } from '@vexel/extractor';
import { ResolvedHubSpotContext } from '../resolver/entity-resolver.service';

export interface ParsedButtonApproval {
  action: 'approve' | 'reject' | 'undo' | 'force_undo';
  tenantId: string;
  runId: string;
}

export interface HubSpotUndoSnapshot {
  tenantId: string;
  runId: string;
  repPhone: string;
  hubspotPortalId: string | null;
  dealId: string;
  dealName: string;
  createdNewDeal: boolean;
  previousDealStage: string | null;
  previousAmount: number | null;
  // Optimistic Concurrency Control (OCC) Watermarks
  syncedDealLastModifiedMs: number;
  committedDealStage: string | null;
  committedAmount: number | null;
  noteId: string | null;
  taskId: string | null;
  receiptWhatsappMessageId?: string;
}

export interface SyncReceiptParams {
  tenantId: string;
  runId: string;
  whatsappPhoneNumberId: string;
  whatsappAccessToken: string;
  repDestinationPhone: string;
  hubspotPortalId: string | null;
  dealId: string;
  dealName: string;
  stageLabel: string;
  amount: number | null;
  currency: string | null;
  syncMode: 'AUTO_SYNC' | 'REP_APPROVED' | 'REP_OVERRIDDEN';
  replyToWhatsappMessageId?: string; // Threads receipt under the approval card if present
  undoSnapshot?: Omit<HubSpotUndoSnapshot, 'receiptWhatsappMessageId'>;
}

export interface PendingApprovalPointer {
  tenantId: string;
  runId: string;
  repPhone: string;
  whatsappMessageId: string;
}

export class WhatsAppApprovalService {
  private readonly GRAPH_API_VERSION = 'v21.0';
  private readonly SESSION_TTL_SECONDS = 24 * 3600; // 24-hour approval window
  private readonly UNDO_WINDOW_SECONDS = 15 * 60; // Strict 15-minute (900s) TTL

  constructor(private readonly redis: Redis) { }

  private getUndoKey(tenantId: string, runId: string): string {
    return `vexel:undo:${tenantId}:${runId}`;
  }

  private getForceUndoKey(tenantId: string, runId: string): string {
    return `vexel:force_undo:${tenantId}:${runId}`;
  }

  private getMsgPointerKey(whatsappMessageId: string): string {
    return `vexel:wa:msg:${whatsappMessageId}`;
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  private getRepPointerKey(tenantId: string, repPhone: string): string {
    const digits = this.normalizePhone(repPhone);
    return `vexel:wa:rep:${tenantId}:${digits}`;
  }

  private signButtonPayload(
    action: 'approve' | 'reject' | 'undo' | 'force_undo',
    tenantId: string,
    runId: string,
  ): string {
    const secret = process.env.VEXEL_APPROVAL_HMAC_SECRET || 'dev_approval_secret';
    const mac = createHmac('sha256', secret)
      .update(`${action}:${tenantId}:${runId}`)
      .digest('hex')
      .slice(0, 16); // 16 hex chars keeps total button ID well under Meta's 256-char limit

    return `vexel_act:${action}:${tenantId}:${runId}:${mac}`;
  }

  /**
   * Verifies HMAC-signed WhatsApp button replies for Approve, Reject, Undo, and Force Undo
   */
  verifyAndParseButtonReply(buttonId: string): ParsedButtonApproval | null {
    const parts = buttonId.split(':');
    if (parts.length !== 5 || parts[0] !== 'vexel_act') {
      return null;
    }

    const [, rawAction, tenantId, runId, providedMac] = parts;
    if (
      rawAction !== 'approve' &&
      rawAction !== 'reject' &&
      rawAction !== 'undo' &&
      rawAction !== 'force_undo'
    ) {
      return null;
    }

    const expectedFull = this.signButtonPayload(rawAction as any, tenantId, runId);
    const expectedMac = expectedFull.split(':')[4];

    const bufA = Buffer.from(providedMac, 'utf8');
    const bufB = Buffer.from(expectedMac, 'utf8');
    if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) {
      throw new Error('Invalid HMAC signature on WhatsApp interactive button');
    }

    return { action: rawAction as any, tenantId, runId };
  }

  /**
   * Atomically pops the 15-minute undo snapshot from Redis using GETDEL.
   * Returns null if the 15-minute window expired or if already clicked.
   * If expectedSenderPhone is provided and does not match snapshot.repPhone,
   * re-arms the snapshot and throws an unauthorized sender error.
   */
  async consumeUndoSnapshot(
    tenantId: string,
    runId: string,
    expectedSenderPhone?: string,
  ): Promise<HubSpotUndoSnapshot | null> {
    const key = this.getUndoKey(tenantId, runId);
    const raw = await this.redis.getdel(key);
    if (!raw) {
      return null;
    }
    const snapshot = JSON.parse(raw) as HubSpotUndoSnapshot;
    if (
      expectedSenderPhone &&
      snapshot.repPhone &&
      this.normalizePhone(expectedSenderPhone) !== this.normalizePhone(snapshot.repPhone)
    ) {
      await this.redis.set(key, raw, 'EX', this.UNDO_WINDOW_SECONDS);
      throw new Error('Unauthorized sender for undo rollback');
    }
    return snapshot;
  }

  /**
   * Stores the snapshot under a force-undo key in Redis when an OCC conflict is encountered
   */
  async armForceUndoSnapshot(snapshot: HubSpotUndoSnapshot): Promise<void> {
    await this.redis.set(
      this.getForceUndoKey(snapshot.tenantId, snapshot.runId),
      JSON.stringify(snapshot),
      'EX',
      this.UNDO_WINDOW_SECONDS,
    );
  }

  /**
   * Atomically pops the force-undo snapshot from Redis using GETDEL
   */
  async consumeForceUndoSnapshot(
    tenantId: string,
    runId: string,
    expectedSenderPhone?: string,
  ): Promise<HubSpotUndoSnapshot | null> {
    const key = this.getForceUndoKey(tenantId, runId);
    const raw = await this.redis.getdel(key);
    if (!raw) {
      return null;
    }
    const snapshot = JSON.parse(raw) as HubSpotUndoSnapshot;
    if (
      expectedSenderPhone &&
      snapshot.repPhone &&
      this.normalizePhone(expectedSenderPhone) !== this.normalizePhone(snapshot.repPhone)
    ) {
      await this.redis.set(key, raw, 'EX', this.UNDO_WINDOW_SECONDS);
      throw new Error('Unauthorized sender for force-undo rollback');
    }
    return snapshot;
  }
  /**
   * Call immediately after sendRepApprovalCard() receives the wamid from Meta Graph API
   */
  async registerPendingApprovalSession(pointer: PendingApprovalPointer): Promise<void> {
    const serialized = JSON.stringify(pointer);
    const pipeline = this.redis.pipeline();

    // 1. Bind exact WhatsApp message ID for swipe-to-reply correlation
    pipeline.set(
      this.getMsgPointerKey(pointer.whatsappMessageId),
      serialized,
      'EX',
      this.SESSION_TTL_SECONDS,
    );

    // 2. Bind rep's phone number for unquoted quick-reply correlation
    pipeline.set(
      this.getRepPointerKey(pointer.tenantId, pointer.repPhone),
      serialized,
      'EX',
      this.SESSION_TTL_SECONDS,
    );

    await pipeline.exec();
  }

  /**
   * Checks if an incoming text message is from a sales rep replying to a paused run.
   * Prioritizes exact quoted context.id (wamid), falling back to the rep's active session.
   */
  async resolveRepOverrideTarget(
    tenantId: string,
    senderPhone: string,
    quotedWhatsappMessageId?: string,
  ): Promise<PendingApprovalPointer | null> {
    if (quotedWhatsappMessageId) {
      const byQuote = await this.redis.get(this.getMsgPointerKey(quotedWhatsappMessageId));
      if (byQuote) {
        const parsed = JSON.parse(byQuote) as PendingApprovalPointer;
        if (parsed.tenantId === tenantId) {
          return parsed;
        }
      }
    }

    const byRepPhone = await this.redis.get(this.getRepPointerKey(tenantId, senderPhone));
    if (byRepPhone) {
      return JSON.parse(byRepPhone) as PendingApprovalPointer;
    }

    return null;
  }

  /**
   * Atomically clears the pending approval session once approved, rejected, or patched
   */
  async consumeApprovalSession(pointer: PendingApprovalPointer): Promise<void> {
    await this.redis.del(
      this.getMsgPointerKey(pointer.whatsappMessageId),
      this.getRepPointerKey(pointer.tenantId, pointer.repPhone),
    );
  }

  /**
   * Sends an interactive 2-button approval card to the sales rep via Meta WhatsApp Cloud API
   */
  async sendRepApprovalCard(params: {
    tenantId: string;
    runId: string;
    whatsappPhoneNumberId: string;
    whatsappAccessToken: string;
    repDestinationPhone: string;
    crmContext: ResolvedHubSpotContext;
    payload: CrmTransitionPayload;
  }): Promise<{ whatsappMessageId: string }> {
    const {
      tenantId,
      runId,
      whatsappPhoneNumberId,
      whatsappAccessToken,
      repDestinationPhone,
      crmContext,
      payload,
    } = params;

    const dealTitle =
      crmContext.currentDealName ?? payload.dealName ?? crmContext.contactName ?? 'New Deal';
    const stageDisplay =
      payload.dealStage === 'unchanged'
        ? `Unchanged (${crmContext.currentDealStage ?? 'Lead'})`
        : `${crmContext.currentDealStage ?? 'New'} -> ${payload.dealStage}`;
    const amountDisplay =
      payload.amount !== null
        ? `${payload.amount.toLocaleString()} ${payload.currency ?? 'USD'}`
        : 'Not specified';

    const cardBody = [
      `⚡ *Vexel CRM Review Required (${payload.confidenceScore}%)*`,
      `• *Deal:* ${dealTitle}`,
      `• *Stage:* ${stageDisplay}`,
      `• *Amount:* ${amountDisplay}`,
      payload.nextTask ? `• *Task:* ${payload.nextTask.title}` : null,
      ``,
      `*Summary:* ${payload.summaryNote.slice(0, 380)}`,
      `_${payload.confidenceReasoning.slice(0, 140)}_`,
    ]
      .filter((line) => line !== null)
      .join('\n');

    const approveButtonId = this.signButtonPayload('approve', tenantId, runId);
    const rejectButtonId = this.signButtonPayload('reject', tenantId, runId);

    const response = await fetch(
      `https://graph.facebook.com/${this.GRAPH_API_VERSION}/${whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${whatsappAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: repDestinationPhone.replace(/\D/g, ''),
          type: 'interactive',
          interactive: {
            type: 'button',
            header: {
              type: 'text',
              text: 'Vexel Pipeline Guard',
            },
            body: {
              text: cardBody.slice(0, 1020), // Meta enforces a 1024-char limit on interactive body
            },
            footer: {
              text: `Run ID: ${runId.slice(-8)} • Tap to commit to HubSpot`,
            },
            action: {
              buttons: [
                {
                  type: 'reply',
                  reply: {
                    id: approveButtonId,
                    title: 'Approve & Sync', // Max 20 chars
                  },
                },
                {
                  type: 'reply',
                  reply: {
                    id: rejectButtonId,
                    title: 'Discard Update', // Max 20 chars
                  },
                },
              ],
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Meta WhatsApp Interactive API failed (${response.status}): ${errBody}`);
    }

    const result = (await response.json()) as { messages?: Array<{ id: string }> };
    return { whatsappMessageId: result.messages?.[0]?.id ?? 'unknown' };
  }

  /**
   * Builds HubSpot's canonical Deal object (0-3) URL.
   * HubSpot automatically redirects app.hubspot.com to app-eu1.hubspot.com for European portals.
   */
  buildHubSpotDealUrl(hubspotPortalId: string | null, dealId: string): string {
    if (!hubspotPortalId) {
      return `https://app.hubspot.com`;
    }
    return `https://app.hubspot.com/contacts/${hubspotPortalId}/record/0-3/${dealId}`;
  }

  /**
   * Sends a 1-line confirmation receipt.
   * If syncMode === 'AUTO_SYNC', attaches an interactive 15-minute [↩️ Undo Sync] button
   * and arms the 900-second Redis rollback snapshot.
   */
  async sendSyncConfirmationReceipt(
    params: SyncReceiptParams,
  ): Promise<{ receiptMessageId: string }> {
    const {
      tenantId,
      runId,
      whatsappPhoneNumberId,
      whatsappAccessToken,
      repDestinationPhone,
      hubspotPortalId,
      dealId,
      dealName,
      stageLabel,
      amount,
      currency,
      syncMode,
      replyToWhatsappMessageId,
      undoSnapshot,
    } = params;

    const dealUrl = this.buildHubSpotDealUrl(hubspotPortalId, dealId);
    const formattedAmount =
      amount !== null ? ` • ${amount.toLocaleString()} ${currency ?? 'USD'}` : '';

    const modeBadge =
      syncMode === 'REP_OVERRIDDEN'
        ? '✅ *Vexel Patched & Synced*'
        : syncMode === 'REP_APPROVED'
          ? '✅ *Vexel Approved & Synced*'
          : '⚡ *Vexel Auto-Synced*';

    const receiptLine = `${modeBadge}: *${dealName}* → *${stageLabel}*${formattedAmount} — ${dealUrl}`;

    let requestBody: Record<string, any>;

    if (syncMode === 'AUTO_SYNC' && undoSnapshot) {
      const undoButtonId = this.signButtonPayload('undo', tenantId, runId);
      requestBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: repDestinationPhone.replace(/\D/g, ''),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: receiptLine,
          },
          footer: {
            text: 'Undo window expires in 15 mins',
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  id: undoButtonId,
                  title: '↩️ Undo Sync (15m)', // 18 chars (Meta limit is 20)
                },
              },
            ],
          },
        },
      };
    } else {
      requestBody = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: repDestinationPhone.replace(/\D/g, ''),
        type: 'text',
        text: {
          preview_url: false,
          body: receiptLine,
        },
      };
    }

    if (replyToWhatsappMessageId) {
      requestBody.context = { message_id: replyToWhatsappMessageId };
    }

    const response = await fetch(
      `https://graph.facebook.com/${this.GRAPH_API_VERSION}/${whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${whatsappAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`WhatsApp receipt dispatch failed (${response.status}): ${errBody}`);
    }

    const result = (await response.json()) as { messages?: Array<{ id: string }> };
    const receiptMessageId = result.messages?.[0]?.id ?? 'unknown';

    // Arm the 15-minute Redis undo snapshot if this was an Auto-Sync
    if (syncMode === 'AUTO_SYNC' && undoSnapshot) {
      const fullSnapshot: HubSpotUndoSnapshot = {
        ...undoSnapshot,
        receiptWhatsappMessageId: receiptMessageId,
      };
      await this.redis.set(
        this.getUndoKey(tenantId, runId),
        JSON.stringify(fullSnapshot),
        'EX',
        this.UNDO_WINDOW_SECONDS,
      );
    }

    return { receiptMessageId };
  }

  /**
   * Sends a threaded 1-line notice confirming rollback completion or 15m window expiration
   */
  async sendUndoStatusNotice(params: {
    whatsappPhoneNumberId: string;
    whatsappAccessToken: string;
    repDestinationPhone: string;
    replyToMessageId?: string;
    text: string;
  }): Promise<void> {
    const body: Record<string, any> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: params.repDestinationPhone.replace(/\D/g, ''),
      type: 'text',
      text: { preview_url: false, body: params.text },
    };

    if (params.replyToMessageId) {
      body.context = { message_id: params.replyToMessageId };
    }

    await fetch(
      `https://graph.facebook.com/${this.GRAPH_API_VERSION}/${params.whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${params.whatsappAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
  }

  /**
   * Sends an interactive WhatsApp card on OCC conflict with a 1-click [⚠️ Force Overwrite] button
   */
  async sendUndoConflictNotice(params: {
    tenantId: string;
    runId: string;
    whatsappPhoneNumberId: string;
    whatsappAccessToken: string;
    repDestinationPhone: string;
    replyToMessageId?: string;
    text: string;
    allowForceOverwrite?: boolean;
  }): Promise<{ messageId?: string }> {
    const {
      tenantId,
      runId,
      whatsappPhoneNumberId,
      whatsappAccessToken,
      repDestinationPhone,
      replyToMessageId,
      text,
      allowForceOverwrite = true,
    } = params;

    let body: Record<string, any>;

    if (allowForceOverwrite) {
      const forceButtonId = this.signButtonPayload('force_undo', tenantId, runId);
      body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: repDestinationPhone.replace(/\D/g, ''),
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: text.slice(0, 1024),
          },
          footer: {
            text: 'Overwrites manual edits in HubSpot',
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  id: forceButtonId,
                  title: '⚠️ Force Overwrite', // 17 chars
                },
              },
            ],
          },
        },
      };
    } else {
      body = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: repDestinationPhone.replace(/\D/g, ''),
        type: 'text',
        text: { preview_url: false, body: text },
      };
    }

    if (replyToMessageId) {
      body.context = { message_id: replyToMessageId };
    }

    const response = await fetch(
      `https://graph.facebook.com/${this.GRAPH_API_VERSION}/${whatsappPhoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${whatsappAccessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`WhatsApp conflict notice dispatch failed (${response.status}): ${errBody}`);
    }

    const result = (await response.json()) as { messages?: Array<{ id: string }> };
    return { messageId: result.messages?.[0]?.id };
  }
}
