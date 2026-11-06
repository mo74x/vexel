import { createHmac, timingSafeEqual } from 'crypto';
import { CrmTransitionPayload } from '@vexel/extractor';
import { ResolvedHubSpotContext } from '../resolver/entity-resolver.service';

export interface ParsedButtonApproval {
  action: 'approve' | 'reject';
  tenantId: string;
  runId: string;
}

export class WhatsAppApprovalService {
  private readonly GRAPH_API_VERSION = 'v21.0';

  private signButtonPayload(action: 'approve' | 'reject', tenantId: string, runId: string): string {
    const secret = process.env.VEXEL_APPROVAL_HMAC_SECRET || 'dev_approval_secret';
    const mac = createHmac('sha256', secret)
      .update(`${action}:${tenantId}:${runId}`)
      .digest('hex')
      .slice(0, 16); // 16 hex chars keeps total button ID well under Meta's 256-char limit

    return `vexel_act:${action}:${tenantId}:${runId}:${mac}`;
  }

  /**
   * Verifies the HMAC-signed button reply when a rep taps [Approve & Sync] or [Discard] on WhatsApp
   */
  verifyAndParseButtonReply(buttonId: string): ParsedButtonApproval | null {
    const parts = buttonId.split(':');
    if (parts.length !== 5 || parts[0] !== 'vexel_act') {
      return null;
    }

    const [, rawAction, tenantId, runId, providedMac] = parts;
    if (rawAction !== 'approve' && rawAction !== 'reject') {
      return null;
    }

    const expectedFull = this.signButtonPayload(rawAction, tenantId, runId);
    const expectedMac = expectedFull.split(':')[4];

    const bufA = Buffer.from(providedMac, 'utf8');
    const bufB = Buffer.from(expectedMac, 'utf8');
    if (bufA.length !== bufB.length || !timingSafeEqual(bufA, bufB)) {
      throw new Error('Invalid HMAC signature on WhatsApp interactive approval button');
    }

    return { action: rawAction, tenantId, runId };
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
}