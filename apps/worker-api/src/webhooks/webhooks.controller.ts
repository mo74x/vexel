import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Req,
  HttpCode,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
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

  @Get(':tenantId/ingest')
  @HttpCode(200)
  verifyWebhookChallenge(
    @Param('tenantId') _tenantId: string,
    @Query('hub.mode') mode?: string,
    @Query('hub.verify_token') verifyToken?: string,
    @Query('hub.challenge') challenge?: string,
  ): string {
    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (mode !== 'subscribe' || !verifyToken || !expectedToken) {
      throw new ForbiddenException('Invalid webhook verification parameters');
    }

    const actualBuf = Buffer.from(verifyToken, 'utf8');
    const expectedBuf = Buffer.from(expectedToken, 'utf8');
    if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
      throw new ForbiddenException('Webhook verify_token mismatch');
    }

    return challenge ?? '';
  }

  @Post(':tenantId/ingest')
  @HttpCode(202)
  async ingestOmnichannelEvent(
    @Param('tenantId') tenantId: string,
    @Headers('x-hub-signature-256') signature: string,
    @Body() body: any,
    @Req() req?: { rawBody?: Buffer },
  ) {
    this.verifyMetaWebhookSignature(signature, body, req?.rawBody);
    await this.verifyTenantPhoneRouting(tenantId, body);

    const rawMsg = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    const buttonReplyId = rawMsg?.interactive?.button_reply?.id;

    if (buttonReplyId && buttonReplyId.startsWith('vexel_act:')) {
      const verified = this.whatsappApproval.verifyAndParseButtonReply(buttonReplyId);
      if (verified) {
        if (verified.tenantId !== tenantId) {
          throw new ForbiddenException('Button reply tenantId does not match webhook route');
        }

        if (verified.action === 'undo') {
          return this.handleRepUndoRequest(
            verified.tenantId,
            verified.runId,
            rawMsg.from,
            rawMsg.context?.id,
          );
        }

        if (verified.action === 'force_undo') {
          return this.handleRepForceUndoRequest(
            verified.tenantId,
            verified.runId,
            rawMsg.from,
            rawMsg.context?.id,
          );
        }

        return this.enqueueRepApproval({
          tenantId: verified.tenantId,
          runId: verified.runId,
          approved: verified.action === 'approve',
        });
      }
    }

    // 1. Handle Meta Delivery Status Callbacks (statuses[]) for failed approval cards
    const statusEvent = body?.entry?.[0]?.changes?.[0]?.value?.statuses?.[0];
    if (statusEvent && statusEvent.status === 'failed' && statusEvent.id) {
      const failedPointer = await this.whatsappApproval.resolveRepOverrideTarget(
        tenantId,
        statusEvent.recipient_id ?? '',
        statusEvent.id,
      );
      if (failedPointer && this.prisma?.workflowRun?.update) {
        const errTitle =
          statusEvent.errors?.[0]?.title ?? 'WhatsApp message delivery failed';
        await TenantContext.run(tenantId, () =>
          this.prisma.workflowRun.update({
            where: { id: failedPointer.runId },
            data: {
              errorMessage: `[WhatsApp Delivery Failed] ${errTitle} (wamid: ${statusEvent.id})`,
            },
          }),
        );
        return {
          status: 'delivery_failure_recorded',
          runId: failedPointer.runId,
          wamid: statusEvent.id,
        };
      }
      return { status: 'delivery_status_ignored', wamid: statusEvent.id };
    }

    // 1b. Normalize incoming WhatsApp / Voice payload
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
            removeOnComplete: true,
          },
        );

        return {
          status: 'rep_text_override_queued',
          runId: pendingApproval.runId,
        };
      }
    }

    // 2b. Two-Step Rep Self-Linking (/link <email> -> /verify <6-digit-otp>)
    if (payload.type === 'text' && payload.text?.trim().toLowerCase().startsWith('/link ')) {
      const emailToBind = payload.text.trim().slice(6).trim();
      const challenge = await TenantContext.run(tenantId, () =>
        this.ownerResolver.requestRepLinkOtp(
          tenantId,
          emailToBind,
          payload.senderPhone,
        ),
      );
      return {
        status: challenge ? 'rep_link_otp_sent' : 'rep_email_not_found_in_hubspot',
        email: challenge?.email ?? null,
        expiresInSeconds: challenge?.expiresInSeconds ?? null,
      };
    }

    if (payload.type === 'text' && payload.text?.trim().toLowerCase().startsWith('/verify ')) {
      const otpCode = payload.text.trim().slice(8).trim();
      const verification = await TenantContext.run(tenantId, () =>
        this.ownerResolver.verifyRepLinkOtp(
          tenantId,
          payload.senderPhone,
          otpCode,
        ),
      );

      if (verification.status === 'verified') {
        return {
          status: 'rep_whatsapp_linked',
          owner: {
            fullName: verification.fullName,
            hubspotOwnerId: verification.hubspotOwnerId,
            email: verification.email,
          },
        };
      }

      return {
        status:
          verification.status === 'max_attempts_exceeded'
            ? 'rep_link_otp_locked'
            : 'rep_link_otp_invalid',
      };
    }

    // 3. Fast SHA-256 edge deduplication
    const eventHash = createHash('sha256')
      .update(`${tenantId}:${payload.messageId}`)
      .digest('hex');

    const isFirstSeen = await this.lockService.claimIdempotencyKey(tenantId, eventHash);
    if (!isFirstSeen) {
      return { status: 'duplicate_dropped', messageId: payload.messageId };
    }

    // 4. Push message into Redis sliding-window list
    const bufferedCount = await this.lockService.appendToBuffer(
      tenantId,
      payload.senderPhone,
      payload,
    );

    // 5. Upsert or reset the 30s delayed BullMQ job for this sender
    const debounceJobId = `debounce:${tenantId}:${payload.senderPhone}`;
    const existingJob = await this.workflowQueue.getJob(debounceJobId);
    let targetJobId = debounceJobId;

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

      if (state === 'waiting' || state === 'prioritized') {
        // Job is queued and has not flushed the Redis buffer yet; it will pick up this message
        return {
          status: 'buffered_into_waiting_job',
          bufferedCount,
          jobId: debounceJobId,
        };
      }

      if (state === 'active') {
        // Active worker already flushed the prior Redis buffer batch; schedule a follow-up generation job
        targetJobId = `${debounceJobId}:${Date.now()}`;
      } else if (state === 'completed' || state === 'failed') {
        await existingJob.remove?.();
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
        jobId: targetJobId,
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
      jobId: targetJobId,
    };
  }

  /**
   * Internal / external callback when a sales rep approves or rejects a WAITING_APPROVAL run.
   * Requires x-vexel-api-key header matching VEXEL_INTERNAL_API_KEY (or VEXEL_APPROVAL_HMAC_SECRET).
   */
  @Post('approval-callback')
  @HttpCode(200)
  async handleRepApproval(
    @Headers('x-vexel-api-key') apiKey: string | undefined,
    @Body() body: { runId: string; tenantId: string; approved: boolean; editedPatch?: Record<string, any> },
  ) {
    this.verifyInternalApiKey(apiKey);
    return this.enqueueRepApproval(body);
  }

  private async enqueueRepApproval(body: {
    runId: string;
    tenantId: string;
    approved: boolean;
    editedPatch?: Record<string, any>;
  }) {
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
        removeOnComplete: true,
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
    let snapshot;
    try {
      // Atomically pop the 15-minute snapshot from Redis while verifying sender phone ownership
      snapshot = await this.whatsappApproval.consumeUndoSnapshot(
        tenantId,
        runId,
        repSenderPhone,
      );
    } catch (err: any) {
      if (err?.message?.includes('Unauthorized sender')) {
        return { status: 'unauthorized_undo_sender', runId };
      }
      throw err;
    }

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
        removeOnComplete: true,
      },
    );

    return { status: 'undo_rollback_queued', runId };
  }

  private async handleRepForceUndoRequest(
    tenantId: string,
    runId: string,
    repSenderPhone: string,
    quotedReceiptWamid?: string,
  ) {
    let snapshot;
    try {
      // Atomically pop the force-undo snapshot from Redis using GETDEL while verifying sender phone
      snapshot = await this.whatsappApproval.consumeForceUndoSnapshot(
        tenantId,
        runId,
        repSenderPhone,
      );
    } catch (err: any) {
      if (err?.message?.includes('Unauthorized sender')) {
        return { status: 'unauthorized_undo_sender', runId };
      }
      throw err;
    }

    if (!snapshot) {
      await this.whatsappApproval.sendUndoStatusNotice({
        whatsappPhoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID!,
        whatsappAccessToken: process.env.WHATSAPP_SYSTEM_TOKEN!,
        repDestinationPhone: repSenderPhone,
        replyToMessageId: quotedReceiptWamid,
        text: `⏳ *Force Overwrite Expired:* The rollback snapshot for Run #${runId.slice(-6)} has expired or was already applied.`,
      });
      return { status: 'force_undo_window_expired', runId };
    }

    await this.workflowQueue.add(
      'execute-revops-pipeline',
      {
        tenantId,
        runId,
        mode: 'FORCE_ROLLBACK_AUTO_SYNC',
        undoSnapshot: snapshot,
      },
      {
        jobId: `force-undo:${runId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
      },
    );

    return { status: 'force_undo_rollback_queued', runId };
  }

  /**
   * Verifies Meta's X-Hub-Signature-256 HMAC-SHA256 header against META_APP_SECRET.
   */
  private verifyMetaWebhookSignature(
    signature: string | undefined,
    body: any,
    rawBody?: Buffer,
  ): void {
    const appSecret = process.env.META_APP_SECRET;
    if (!appSecret) {
      return;
    }

    if (!signature || !signature.startsWith('sha256=')) {
      throw new UnauthorizedException('Missing or malformed X-Hub-Signature-256 header');
    }

    const payloadBuffer =
      rawBody ?? Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
    const expectedHex = createHmac('sha256', appSecret).update(payloadBuffer).digest('hex');
    const providedHex = signature.slice('sha256='.length);

    if (
      providedHex.length !== expectedHex.length ||
      !/^[0-9a-fA-F]+$/.test(providedHex)
    ) {
      throw new UnauthorizedException('Invalid X-Hub-Signature-256 signature');
    }

    const providedBuf = Buffer.from(providedHex, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');

    if (providedBuf.length !== expectedBuf.length || !timingSafeEqual(providedBuf, expectedBuf)) {
      throw new UnauthorizedException('Invalid X-Hub-Signature-256 signature');
    }
  }

  /**
   * Ensures that when Meta sends metadata.phone_number_id, it matches the Tenant's registered whatsappPhoneId.
   */
  private async verifyTenantPhoneRouting(tenantId: string, body: any): Promise<void> {
    const metadataPhoneId =
      body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id;
    if (!metadataPhoneId || !this.prisma?.tenant?.findUnique) {
      return;
    }

    const tenant = await TenantContext.run(tenantId, () =>
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { id: true, whatsappPhoneId: true },
      }),
    );

    if (!tenant) {
      throw new ForbiddenException(`Unknown tenantId "${tenantId}"`);
    }

    if (tenant.whatsappPhoneId && tenant.whatsappPhoneId !== String(metadataPhoneId)) {
      throw new ForbiddenException(
        'Webhook metadata.phone_number_id does not match tenant whatsappPhoneId',
      );
    }
  }

  private verifyInternalApiKey(apiKey: string | undefined): void {
    const expectedSecret =
      process.env.VEXEL_INTERNAL_API_KEY || process.env.VEXEL_APPROVAL_HMAC_SECRET;
    if (!expectedSecret || !apiKey) {
      throw new UnauthorizedException('Missing internal API key');
    }

    const actualBuf = Buffer.from(apiKey, 'utf8');
    const expectedBuf = Buffer.from(expectedSecret, 'utf8');
    if (actualBuf.length !== expectedBuf.length || !timingSafeEqual(actualBuf, expectedBuf)) {
      throw new UnauthorizedException('Invalid internal API key');
    }
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
