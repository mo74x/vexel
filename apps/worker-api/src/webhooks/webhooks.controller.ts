import {
  Controller,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  BadRequestException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash } from 'crypto';
import { VexelLockService, InboundEventPayload } from '../redis/vexel-lock.service';
import {
  EnvelopeCryptoService,
  HubSpotHttpClient,
  HubSpotOwnerResolverService,
  HubSpotTokenManagerService,
  WhatsAppApprovalService,
} from '@vexel/crm-hubspot';
import { PrismaClient } from '@prisma/client';
import { PrismaService, TenantContext } from '@vexel/database';

@Controller('v1/webhooks')
export class WebhooksController {
  private readonly DEBOUNCE_WINDOW_MS = 30_000; // 30-second sliding window
  private readonly whatsappApproval: WhatsAppApprovalService;
  private readonly ownerResolver: HubSpotOwnerResolverService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: VexelLockService,
    @InjectQueue('vexel-workflows') private readonly workflowQueue: Queue,
  ) {
    this.whatsappApproval = new WhatsAppApprovalService(this.lockService.redis);
    const rawPrisma = this.prisma.client as unknown as PrismaClient;
    const envelopeCrypto = new EnvelopeCryptoService();
    const tokenManager = new HubSpotTokenManagerService(
      rawPrisma,
      this.lockService.redis,
      envelopeCrypto,
    );
    const httpClient = new HubSpotHttpClient(this.lockService.redis, tokenManager);
    this.ownerResolver = new HubSpotOwnerResolverService(
      this.prisma.client,
      this.lockService.redis,
      httpClient,
    );
  }

  @Post(':tenantId/ingest')
  @HttpCode(202)
  async ingestOmnichannelEvent(
    @Param('tenantId') tenantId: string,
    @Headers('x-hub-signature-256') signature: string,
    @Body() body: any,
  ) {
    const rawMsg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const buttonReplyId = rawMsg?.interactive?.button_reply?.id;

    if (buttonReplyId && buttonReplyId.startsWith('vexel_act:')) {
      const verified = this.whatsappApproval.verifyAndParseButtonReply(buttonReplyId);
      if (verified) {
        if (verified.action === 'undo') {
          return this.handleRepUndoRequest(
            verified.tenantId,
            verified.runId,
            rawMsg.from,
            rawMsg.context?.id,
          );
        }

        return this.handleRepApproval({
          tenantId: verified.tenantId,
          runId: verified.runId,
          approved: verified.action === 'approve',
        });
      }
    }

    // 1. Normalize incoming WhatsApp / Voice payload
    const payload = this.normalizePayload(body);
    if (!payload) {
      return { status: 'ignored_non_message_event' };
    }

    // 2. Check if this text message is from a Sales Rep overriding a WAITING_APPROVAL run
    if (payload.type === 'text' && payload.text) {
      const pendingApproval = await this.whatsappApproval.resolveRepOverrideTarget(
        tenantId,
        payload.senderPhone,
        payload.contextMessageId,
      );

      if (pendingApproval) {
        // Atomically consume the session pointer so double-taps cannot double-patch
        await this.whatsappApproval.consumeApprovalSession(pendingApproval);

        await this.workflowQueue.add(
          'execute-revops-pipeline',
          {
            tenantId: pendingApproval.tenantId,
            runId: pendingApproval.runId,
            mode: 'RESUME_AFTER_APPROVAL',
            approved: true,
            rawRepOverrideText: payload.text,
          },
          {
            jobId: `resume-override:${pendingApproval.runId}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 4000 },
          },
        );

        return {
          status: 'rep_text_override_queued',
          runId: pendingApproval.runId,
        };
      }
    }

    if (payload.type === 'text' && payload.text?.trim().toLowerCase().startsWith('/link ')) {
      const emailToBind = payload.text.trim().slice(6).trim();
      const bound = await TenantContext.run(tenantId, () =>
        this.ownerResolver.bindRepWhatsAppByEmail(
          tenantId,
          emailToBind,
          payload.senderPhone,
        ),
      );
      return {
        status: bound ? 'rep_whatsapp_linked' : 'rep_email_not_found_in_hubspot',
        owner: bound,
      };
    }

    // 2. Fast SHA-256 edge deduplication
    const eventHash = createHash('sha256')
      .update(`${tenantId}:${payload.messageId}`)
      .digest('hex');

    const isFirstSeen = await this.lockService.claimIdempotencyKey(tenantId, eventHash);
    if (!isFirstSeen) {
      return { status: 'duplicate_dropped', messageId: payload.messageId };
    }

    // 3. Push message into Redis sliding-window list
    const bufferedCount = await this.lockService.appendToBuffer(
      tenantId,
      payload.senderPhone,
      payload,
    );

    // 4. Upsert or reset the 30s delayed BullMQ job for this sender
    const debounceJobId = `debounce:${tenantId}:${payload.senderPhone}`;
    const existingJob = await this.workflowQueue.getJob(debounceJobId);

    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'delayed') {
        // Push the timer forward by another 30 seconds from now
        await existingJob.changeDelay(this.DEBOUNCE_WINDOW_MS);
        return {
          status: 'debounced_window_extended',
          bufferedCount,
          jobId: debounceJobId,
        };
      }
    }

    await this.workflowQueue.add(
      'execute-revops-pipeline',
      {
        tenantId,
        senderPhone: payload.senderPhone,
        mode: 'INITIAL_INGEST',
      },
      {
        jobId: debounceJobId,
        delay: this.DEBOUNCE_WINDOW_MS,
        attempts: 5,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
      },
    );

    return {
      status: 'buffered_and_scheduled',
      bufferedCount,
      executeInMs: this.DEBOUNCE_WINDOW_MS,
    };
  }

  /**
   * Triggered when a sales rep clicks [Approve & Sync] on WhatsApp or Slack
   */
  @Post('approval-callback')
  @HttpCode(200)
  async handleRepApproval(
    @Body() body: { runId: string; tenantId: string; approved: boolean; editedPatch?: Record<string, any> },
  ) {
    if (!body.runId || !body.tenantId) {
      throw new BadRequestException('Missing runId or tenantId');
    }

    await this.workflowQueue.add(
      'execute-revops-pipeline',
      {
        tenantId: body.tenantId,
        runId: body.runId,
        mode: 'RESUME_AFTER_APPROVAL',
        approved: body.approved,
        editedPatch: body.editedPatch,
      },
      {
        jobId: `resume:${body.runId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 4000 },
      },
    );

    return { status: 'workflow_resumed', runId: body.runId };
  }

  private async handleRepUndoRequest(
    tenantId: string,
    runId: string,
    repSenderPhone: string,
    quotedReceiptWamid?: string,
  ) {
    // Atomically pop the 15-minute snapshot from Redis
    const snapshot = await this.whatsappApproval.consumeUndoSnapshot(tenantId, runId);

    if (!snapshot) {
      // Window expired (>15 mins) or already undone -> send immediate notice
      await this.whatsappApproval.sendUndoStatusNotice({
        whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
        whatsappAccessToken: process.env.WHATSAPP_SYSTEM_TOKEN!,
        repDestinationPhone: repSenderPhone,
        replyToMessageId: quotedReceiptWamid,
        text: `⏳ *Undo Window Expired:* The 15-minute rollback window for Run #${runId.slice(-6)} has closed, or this update was already reverted.`,
      });
      return { status: 'undo_window_expired', runId };
    }

    await this.workflowQueue.add(
      'execute-revops-pipeline',
      {
        tenantId,
        runId,
        mode: 'ROLLBACK_AUTO_SYNC',
        undoSnapshot: snapshot,
      },
      {
        jobId: `undo:${runId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
      },
    );

    return { status: 'undo_rollback_queued', runId };
  }

  private normalizePayload(body: any): (InboundEventPayload & { contextMessageId?: string }) | null {
    const entry = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!entry) return null;

    return {
      messageId: entry.id,
      senderPhone: entry.from,
      type: entry.type === 'audio' ? 'audio' : 'text',
      text: entry.text?.body,
      mediaUrl: entry.audio?.id,
      contextMessageId: entry.context?.id, // Populated when rep swipes-to-reply on the card
      timestamp: Number(entry.timestamp) * 1000,
    };
  }
}
