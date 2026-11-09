import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { MembershipRole, RunOutcome, RunStatus } from '@prisma/client';
import { PrismaService } from '@vexel/database';
import { VexelLockService } from '../redis/vexel-lock.service';
import {
  EnvelopeCryptoService,
  HubSpotHttpClient,
  HubSpotOwnerResolverService,
  HubSpotTokenManagerService,
} from '@vexel/crm-hubspot';
import { formatPhoneNumberForRole } from './utils/phone-mask.util';

export const E164_PHONE_REGEX = /^\+[1-9]\d{1,14}$/;

export function validateE164Phone(phone: string, fieldName = 'phone'): string {
  const trimmed = phone.trim();
  if (!E164_PHONE_REGEX.test(trimmed)) {
    throw new BadRequestException(
      `Invalid ${fieldName} "${phone}". Must be a valid E.164 phone number starting with + and country code (e.g. +201012345678).`,
    );
  }
  return trimmed;
}

export interface TenantSettingsDto {
  id: string;
  name: string;
  slug: string;
  hubspotPortalId: string | null;
  hubspotConnected: boolean;
  whatsappPhoneId: string | null;
  whatsappConnected: boolean;
  fallbackApprovalPhone: string | null;
  autoSyncThreshold: number;
  manualMinutesPerUpdate: number;
  locale: string;
  timezone: string;
}

export class UpdateTenantSettingsDto {
  name?: string;
  autoSyncThreshold?: number;
  fallbackApprovalPhone?: string | null;
  whatsappPhoneId?: string | null;
  rawWhatsAppToken?: string;
  manualMinutesPerUpdate?: number;
}

export interface RunListItemDto {
  id: string;
  workflowName: string;
  externalDealId: string | null;
  status: RunStatus;
  outcome: RunOutcome | null;
  confidenceScore: number | null;
  senderPhone: string | null;
  oneLineSummary: string;
  overriddenFields: Record<string, any> | null;
  errorMessage: string | null;
  decidedByRep: {
    id: string;
    fullName: string;
    email: string;
    whatsappPhone: string | null;
  } | null;
  decidedAt: Date | null;
  undoneAt: Date | null;
  createdAt: Date;
  startedAt: Date;
  completedAt: Date | null;
}

export interface RunListResponseDto {
  items: RunListItemDto[];
  nextCursor: string | null;
  hasMore: boolean;
  limit: number;
}

export interface RunDetailDto extends RunListItemDto {
  inputPayload: Record<string, any>;
  extractedData: Record<string, any> | null;
  transcript: string | null;
  undoAvailable: boolean;
  undoType: 'STANDARD' | 'FORCE' | null;
  steps: Array<{
    id: string;
    stepKey: string;
    status: string;
    durationMs: number | null;
    executedAt: Date;
    errorLog: string | null;
    outputData: Record<string, any> | null;
  }>;
}

export interface DailyMetricBucketDto {
  date: string;
  total: number;
  autoSynced: number;
  approvedAsIs: number;
  approvedWithOverride: number;
  rejected: number;
  failed: number;
}

export interface RepActivitySummaryDto {
  repId: string;
  fullName: string;
  email: string;
  totalRuns: number;
  autoSyncedCount: number;
  approvedCount: number;
  overrideCount: number;
  rejectedCount: number;
  averageConfidence: number | null;
}

export interface MetricsSummaryDto {
  window: { from: string; to: string };
  totalRuns: number;
  runsByOutcome: Record<string, number>;
  runsByStatus: Record<string, number>;
  autoSyncRate: number; // percentage (0 - 100)
  approvalRate: number; // percentage of reviewed runs approved
  editRate: number; // percentage of approved runs that had field edits
  averageConfidence: number | null;
  estimatedMinutesSaved: number;
  manualMinutesPerUpdate: number;
  totalCostUsd: number;
  costPerRun: number;
  dailyBuckets: DailyMetricBucketDto[];
  repsActivity: RepActivitySummaryDto[];
}

export interface OnboardingStatusDto {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  hubspotConnected: boolean;
  hubspotPortalId: string | null;
  whatsappConnected: boolean;
  whatsappPhoneId: string | null;
  repsLinkedCount: number;
  totalRepsCount: number;
  firstRunReceived: boolean;
  firstRunAt: Date | null;
  autoSyncThreshold: number;
  manualMinutesPerUpdate: number;
}

@Injectable()
export class AppPortalService {
  private readonly ownerResolver: HubSpotOwnerResolverService;
  private readonly tokenManager: HubSpotTokenManagerService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: VexelLockService,
    @InjectQueue('vexel-workflows') private readonly workflowQueue: Queue,
  ) {
    const rawPrisma = (this.prisma as any).client ?? this.prisma;
    const envelopeCrypto = new EnvelopeCryptoService();
    this.tokenManager = new HubSpotTokenManagerService(
      rawPrisma,
      this.lockService.redis,
      envelopeCrypto,
    );
    const httpClient = new HubSpotHttpClient(this.lockService.redis, this.tokenManager);
    this.ownerResolver = new HubSpotOwnerResolverService(
      rawPrisma,
      this.lockService.redis,
      httpClient,
    );
  }

  /**
   * GET /v1/app/runs with cursor pagination, filtering, and role-based phone masking
   */
  async listRuns(params: {
    tenantId: string;
    role: MembershipRole;
    status?: RunStatus;
    outcome?: RunOutcome;
    repId?: string;
    from?: string;
    to?: string;
    cursor?: string;
    limit?: number;
  }): Promise<RunListResponseDto> {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

    const where: Record<string, any> = {
      tenantId: params.tenantId,
    };

    if (params.status) {
      where.status = params.status;
    }
    if (params.outcome) {
      where.outcome = params.outcome;
    }
    if (params.repId) {
      where.decidedByRepId = params.repId;
    }

    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) where.createdAt.lte = new Date(params.to);
    }

    const runs = await this.prisma.workflowRun.findMany({
      where,
      take: limit + 1,
      skip: params.cursor ? 1 : 0,
      cursor: params.cursor ? { id: params.cursor } : undefined,
      orderBy: { createdAt: 'desc' },
      include: {
        decidedByRep: {
          select: {
            id: true,
            fullName: true,
            email: true,
            whatsappPhone: true,
          },
        },
      },
    });

    const hasMore = runs.length > limit;
    const itemsToReturn = hasMore ? runs.slice(0, limit) : runs;
    const nextCursor = hasMore ? itemsToReturn[itemsToReturn.length - 1].id : null;

    const items: RunListItemDto[] = itemsToReturn.map((run: any) =>
      this.formatRunListItem(run, params.role),
    );

    return {
      items,
      nextCursor,
      hasMore,
      limit,
    };
  }

  /**
   * GET /v1/app/runs/:id with steps, transcript, and undo availability check in Redis
   */
  async getRunDetail(
    tenantId: string,
    runId: string,
    role: MembershipRole,
  ): Promise<RunDetailDto> {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, tenantId },
      include: {
        steps: {
          orderBy: { executedAt: 'asc' },
        },
        decidedByRep: {
          select: {
            id: true,
            fullName: true,
            email: true,
            whatsappPhone: true,
          },
        },
      },
    });

    if (!run) {
      throw new NotFoundException(`WorkflowRun "${runId}" not found for tenant`);
    }

    // Check Redis for active 15-minute undo snapshot
    const undoKey = `vexel:undo:${tenantId}:${runId}`;
    const forceUndoKey = `vexel:force_undo:${tenantId}:${runId}`;

    const [hasUndo, hasForceUndo] = await Promise.all([
      this.lockService.redis.exists(undoKey),
      this.lockService.redis.exists(forceUndoKey),
    ]);

    const undoAvailable = Boolean(hasUndo || hasForceUndo);
    const undoType: 'STANDARD' | 'FORCE' | null = hasForceUndo
      ? 'FORCE'
      : hasUndo
        ? 'STANDARD'
        : null;

    const baseItem = this.formatRunListItem(run, role);

    // Extract merged transcript from Step 1 or inputPayload
    const step1 = run.steps?.find((s: any) => s.stepKey === 'step-1-transcribe-window');
    const transcript: string | null =
      (step1?.outputData as any)?.mergedTranscript ??
      (run.inputPayload as any)?.text ??
      null;

    const formattedPayload = { ...(run.inputPayload as Record<string, any>) };
    if (formattedPayload.senderPhone) {
      formattedPayload.senderPhone = formatPhoneNumberForRole(
        formattedPayload.senderPhone,
        role,
      );
    }

    return {
      ...baseItem,
      inputPayload: formattedPayload,
      extractedData: run.extractedData as Record<string, any> | null,
      transcript,
      undoAvailable,
      undoType,
      steps: (run.steps ?? []).map((s: any) => ({
        id: s.id,
        stepKey: s.stepKey,
        status: s.status,
        durationMs: s.durationMs,
        executedAt: s.executedAt,
        errorLog: s.errorLog,
        outputData: s.outputData,
      })),
    };
  }

  /**
   * POST /v1/app/runs/:id/approve - Reuses the resume queue logic
   */
  async approveRun(
    tenantId: string,
    runId: string,
    actorUserId: string,
    editedPatch?: Record<string, any>,
  ): Promise<{ status: string; runId: string }> {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, tenantId },
    });

    if (!run) {
      throw new NotFoundException(`WorkflowRun "${runId}" not found for tenant`);
    }

    if (run.status !== RunStatus.WAITING_APPROVAL) {
      throw new BadRequestException(
        `Cannot approve run "${runId}" with status "${run.status}". Only WAITING_APPROVAL runs can be approved.`,
      );
    }

    await this.workflowQueue.add(
      'execute-revops-pipeline',
      {
        tenantId,
        runId,
        mode: 'RESUME_AFTER_APPROVAL',
        approved: true,
        editedPatch,
        actorUserId,
      },
      {
        jobId: `resume:${runId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 4000 },
        removeOnComplete: true,
      },
    );

    await this.recordAuditLog({
      tenantId,
      actorUserId,
      action: 'workflow_run.app_approved',
      targetType: 'WorkflowRun',
      targetId: runId,
      meta: { editedPatch: editedPatch ?? null },
    });

    return { status: 'workflow_resumed', runId };
  }

  /**
   * POST /v1/app/runs/:id/reject - Reuses the resume rejection queue logic
   */
  async rejectRun(
    tenantId: string,
    runId: string,
    actorUserId: string,
    reason?: string,
  ): Promise<{ status: string; runId: string }> {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, tenantId },
    });

    if (!run) {
      throw new NotFoundException(`WorkflowRun "${runId}" not found for tenant`);
    }

    if (run.status !== RunStatus.WAITING_APPROVAL) {
      throw new BadRequestException(
        `Cannot reject run "${runId}" with status "${run.status}". Only WAITING_APPROVAL runs can be rejected.`,
      );
    }

    await this.workflowQueue.add(
      'execute-revops-pipeline',
      {
        tenantId,
        runId,
        mode: 'RESUME_AFTER_APPROVAL',
        approved: false,
        actorUserId,
      },
      {
        jobId: `resume:${runId}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 4000 },
        removeOnComplete: true,
      },
    );

    await this.recordAuditLog({
      tenantId,
      actorUserId,
      action: 'workflow_run.app_rejected',
      targetType: 'WorkflowRun',
      targetId: runId,
      meta: { reason: reason ?? null },
    });

    return { status: 'workflow_rejected', runId };
  }

  /**
   * POST /v1/app/runs/:id/replay - Replays a DEAD_LETTER or FAILED run
   */
  async replayRun(
    tenantId: string,
    runId: string,
    actorUserId: string,
  ): Promise<{ status: string; runId: string; jobId: string }> {
    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, tenantId },
    });

    if (!run) {
      throw new NotFoundException(`WorkflowRun "${runId}" not found for tenant`);
    }

    if (run.status !== RunStatus.DEAD_LETTER && run.status !== RunStatus.FAILED) {
      throw new BadRequestException(
        `Only DEAD_LETTER or FAILED runs can be replayed (current status: ${run.status})`,
      );
    }

    const replayJobId = `dlq-replay:${runId}:${Date.now()}`;

    await this.prisma.workflowRun.update({
      where: { id: runId },
      data: {
        status: RunStatus.RUNNING,
        outcome: null,
        errorMessage: null,
      },
    });

    await this.workflowQueue.add(
      'execute-revops-pipeline',
      {
        tenantId,
        runId,
        senderPhone: (run.inputPayload as any)?.senderPhone,
        mode: 'INITIAL_INGEST',
        actorUserId,
      },
      {
        jobId: replayJobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 4000 },
        removeOnComplete: true,
      },
    );

    await this.recordAuditLog({
      tenantId,
      actorUserId,
      action: 'workflow_run.app_replayed',
      targetType: 'WorkflowRun',
      targetId: runId,
      meta: { jobId: replayJobId },
    });

    return { status: 'dlq_run_requeued', runId, jobId: replayJobId };
  }

  /**
   * Reps: List
   */
  async listReps(tenantId: string, role: MembershipRole) {
    const reps = await this.prisma.tenantRep.findMany({
      where: { tenantId },
      orderBy: { fullName: 'asc' },
    });

    return reps.map((rep: any) => ({
      id: rep.id,
      tenantId: rep.tenantId,
      hubspotOwnerId: rep.hubspotOwnerId,
      email: rep.email,
      fullName: rep.fullName,
      whatsappPhone: formatPhoneNumberForRole(rep.whatsappPhone, role),
      isActive: rep.isActive,
      updatedAt: rep.updatedAt,
    }));
  }

  /**
   * Reps: Create
   */
  async createRep(
    tenantId: string,
    actorUserId: string,
    body: {
      hubspotOwnerId: string;
      email: string;
      fullName: string;
      whatsappPhone?: string;
      isActive?: boolean;
    },
  ) {
    if (!body.hubspotOwnerId || !body.email || !body.fullName) {
      throw new BadRequestException('hubspotOwnerId, email, and fullName are required');
    }

    const email = body.email.toLowerCase().trim();
    const whatsappPhone = body.whatsappPhone?.trim()
      ? validateE164Phone(body.whatsappPhone, 'whatsappPhone')
      : null;

    const rep = await this.prisma.tenantRep.create({
      data: {
        tenantId,
        hubspotOwnerId: String(body.hubspotOwnerId).trim(),
        email,
        fullName: body.fullName.trim(),
        whatsappPhone,
        isActive: body.isActive ?? true,
      },
    });

    // Invalidate owners cache in Redis
    await this.lockService.redis.del(`vexel:owners:${tenantId}`);

    await this.recordAuditLog({
      tenantId,
      actorUserId,
      action: 'rep.created',
      targetType: 'TenantRep',
      targetId: rep.id,
      meta: { email: rep.email, hubspotOwnerId: rep.hubspotOwnerId },
    });

    return rep;
  }

  /**
   * Reps: Update
   */
  async updateRep(
    tenantId: string,
    repId: string,
    actorUserId: string,
    body: {
      fullName?: string;
      email?: string;
      whatsappPhone?: string | null;
      isActive?: boolean;
    },
  ) {
    const existing = await this.prisma.tenantRep.findFirst({
      where: { id: repId, tenantId },
    });

    if (!existing) {
      throw new NotFoundException(`TenantRep "${repId}" not found for tenant`);
    }

    const data: Record<string, any> = {};
    if (body.fullName !== undefined) data.fullName = body.fullName.trim();
    if (body.email !== undefined) data.email = body.email.toLowerCase().trim();
    if (body.whatsappPhone !== undefined) {
      data.whatsappPhone = body.whatsappPhone?.trim()
        ? validateE164Phone(body.whatsappPhone, 'whatsappPhone')
        : null;
    }
    if (body.isActive !== undefined) data.isActive = body.isActive;

    const updated = await this.prisma.tenantRep.update({
      where: { id: repId },
      data,
    });

    await this.lockService.redis.del(`vexel:owners:${tenantId}`);

    await this.recordAuditLog({
      tenantId,
      actorUserId,
      action: 'rep.updated',
      targetType: 'TenantRep',
      targetId: repId,
      meta: data,
    });

    return updated;
  }

  /**
   * Reps: Send OTP Link Code (reuses ownerResolver.requestRepLinkOtp)
   */
  async sendRepLinkCode(
    tenantId: string,
    repId: string,
    actorUserId: string,
  ): Promise<{ status: string; email: string; expiresInSeconds: number }> {
    const rep = await this.prisma.tenantRep.findFirst({
      where: { id: repId, tenantId },
    });

    if (!rep) {
      throw new NotFoundException(`TenantRep "${repId}" not found for tenant`);
    }

    const phoneToUse = rep.whatsappPhone || 'default';
    const challenge = await this.ownerResolver.requestRepLinkOtp(
      tenantId,
      rep.email,
      phoneToUse,
    );

    if (!challenge) {
      throw new BadRequestException(
        `Failed to generate link code for rep "${rep.email}". Ensure the rep exists in HubSpot owners.`,
      );
    }

    await this.recordAuditLog({
      tenantId,
      actorUserId,
      action: 'rep.link_code_sent',
      targetType: 'TenantRep',
      targetId: rep.id,
      meta: { email: rep.email, phone: phoneToUse },
    });

    return {
      status: 'otp_sent',
      email: challenge.email,
      expiresInSeconds: challenge.expiresInSeconds,
    };
  }

  /**
   * GET /v1/app/metrics - Aggregates runs by outcome, calculates rates, minutes saved, and cost
   */
  async getMetrics(
    tenantId: string,
    from?: string,
    to?: string,
  ): Promise<MetricsSummaryDto> {
    const toDate = to ? new Date(to) : new Date();
    const fromDate = from ? new Date(from) : new Date(toDate.getTime() - 30 * 24 * 3600 * 1000);

    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { manualMinutesPerUpdate: true },
    });

    const manualMinutesPerUpdate = tenant?.manualMinutesPerUpdate ?? 5;

    const runs = await this.prisma.workflowRun.findMany({
      where: {
        tenantId,
        createdAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      select: {
        id: true,
        status: true,
        outcome: true,
        confidenceScore: true,
        createdAt: true,
        decidedByRepId: true,
        decidedByRep: {
          select: {
            id: true,
            fullName: true,
            email: true,
          },
        },
      },
    });

    const runsByOutcome: Record<string, number> = {
      [RunOutcome.AUTO_SYNCED]: 0,
      [RunOutcome.APPROVED_AS_IS]: 0,
      [RunOutcome.APPROVED_WITH_OVERRIDE]: 0,
      [RunOutcome.REJECTED]: 0,
      [RunOutcome.EXPIRED]: 0,
      [RunOutcome.UNDONE]: 0,
      [RunOutcome.FAILED]: 0,
    };

    const runsByStatus: Record<string, number> = {
      [RunStatus.PENDING]: 0,
      [RunStatus.RUNNING]: 0,
      [RunStatus.WAITING_APPROVAL]: 0,
      [RunStatus.COMPLETED]: 0,
      [RunStatus.FAILED]: 0,
      [RunStatus.DEAD_LETTER]: 0,
    };

    let totalConfidence = 0;
    let confidenceCount = 0;

    // Daily buckets map: date string (YYYY-MM-DD) -> bucket
    const dailyMap = new Map<string, DailyMetricBucketDto>();
    const curDate = new Date(fromDate);
    curDate.setUTCHours(0, 0, 0, 0);
    const endDate = new Date(toDate);
    endDate.setUTCHours(23, 59, 59, 999);

    while (curDate <= endDate) {
      const dStr = curDate.toISOString().slice(0, 10);
      dailyMap.set(dStr, {
        date: dStr,
        total: 0,
        autoSynced: 0,
        approvedAsIs: 0,
        approvedWithOverride: 0,
        rejected: 0,
        failed: 0,
      });
      curDate.setUTCDate(curDate.getUTCDate() + 1);
    }

    // Reps activity map: repId -> summary
    const repMap = new Map<
      string,
      {
        repId: string;
        fullName: string;
        email: string;
        totalRuns: number;
        autoSyncedCount: number;
        approvedCount: number;
        overrideCount: number;
        rejectedCount: number;
        totalConfidence: number;
        confidenceCount: number;
      }
    >();

    for (const run of runs) {
      if (run.outcome && runsByOutcome[run.outcome] !== undefined) {
        runsByOutcome[run.outcome]++;
      }
      if (run.status && runsByStatus[run.status] !== undefined) {
        runsByStatus[run.status]++;
      }
      if (typeof run.confidenceScore === 'number') {
        totalConfidence += run.confidenceScore;
        confidenceCount++;
      }

      // Aggregate into daily buckets
      const runDateStr = run.createdAt.toISOString().slice(0, 10);
      let dayBucket = dailyMap.get(runDateStr);
      if (!dayBucket) {
        dayBucket = {
          date: runDateStr,
          total: 0,
          autoSynced: 0,
          approvedAsIs: 0,
          approvedWithOverride: 0,
          rejected: 0,
          failed: 0,
        };
        dailyMap.set(runDateStr, dayBucket);
      }
      dayBucket.total++;
      if (run.outcome === RunOutcome.AUTO_SYNCED) {
        dayBucket.autoSynced++;
      } else if (run.outcome === RunOutcome.APPROVED_AS_IS) {
        dayBucket.approvedAsIs++;
      } else if (run.outcome === RunOutcome.APPROVED_WITH_OVERRIDE) {
        dayBucket.approvedWithOverride++;
      } else if (run.outcome === RunOutcome.REJECTED) {
        dayBucket.rejected++;
      } else if (run.outcome === RunOutcome.FAILED || run.status === RunStatus.FAILED) {
        dayBucket.failed++;
      }

      // Aggregate into reps activity
      if (run.decidedByRep) {
        const rep = run.decidedByRep;
        let repEntry = repMap.get(rep.id);
        if (!repEntry) {
          repEntry = {
            repId: rep.id,
            fullName: rep.fullName,
            email: rep.email,
            totalRuns: 0,
            autoSyncedCount: 0,
            approvedCount: 0,
            overrideCount: 0,
            rejectedCount: 0,
            totalConfidence: 0,
            confidenceCount: 0,
          };
          repMap.set(rep.id, repEntry);
        }
        repEntry.totalRuns++;
        if (run.outcome === RunOutcome.AUTO_SYNCED) {
          repEntry.autoSyncedCount++;
        } else if (run.outcome === RunOutcome.APPROVED_AS_IS) {
          repEntry.approvedCount++;
        } else if (run.outcome === RunOutcome.APPROVED_WITH_OVERRIDE) {
          repEntry.approvedCount++;
          repEntry.overrideCount++;
        } else if (run.outcome === RunOutcome.REJECTED) {
          repEntry.rejectedCount++;
        }
        if (typeof run.confidenceScore === 'number') {
          repEntry.totalConfidence += run.confidenceScore;
          repEntry.confidenceCount++;
        }
      }
    }

    const dailyBuckets = Array.from(dailyMap.values()).sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    const repsActivity: RepActivitySummaryDto[] = Array.from(repMap.values())
      .map((r) => ({
        repId: r.repId,
        fullName: r.fullName,
        email: r.email,
        totalRuns: r.totalRuns,
        autoSyncedCount: r.autoSyncedCount,
        approvedCount: r.approvedCount,
        overrideCount: r.overrideCount,
        rejectedCount: r.rejectedCount,
        averageConfidence:
          r.confidenceCount > 0
            ? Number((r.totalConfidence / r.confidenceCount).toFixed(1))
            : null,
      }))
      .sort((a, b) => b.totalRuns - a.totalRuns);

    const totalRuns = runs.length;
    const autoSynced = runsByOutcome[RunOutcome.AUTO_SYNCED];
    const approvedAsIs = runsByOutcome[RunOutcome.APPROVED_AS_IS];
    const approvedWithOverride = runsByOutcome[RunOutcome.APPROVED_WITH_OVERRIDE];
    const rejected = runsByOutcome[RunOutcome.REJECTED];

    const totalApproved = approvedAsIs + approvedWithOverride;
    const totalReviewed = totalApproved + rejected;

    const autoSyncRate = totalRuns > 0 ? Number(((autoSynced / totalRuns) * 100).toFixed(1)) : 0;
    const approvalRate = totalReviewed > 0 ? Number(((totalApproved / totalReviewed) * 100).toFixed(1)) : 0;
    const editRate = totalApproved > 0 ? Number(((approvedWithOverride / totalApproved) * 100).toFixed(1)) : 0;
    const averageConfidence = confidenceCount > 0 ? Number((totalConfidence / confidenceCount).toFixed(1)) : null;

    // Estimated minutes saved: auto-synced + approved runs * manualMinutesPerUpdate
    const successfulSyncs = autoSynced + totalApproved;
    const estimatedMinutesSaved = successfulSyncs * manualMinutesPerUpdate;

    // Cost from UsageLedger
    const usageAggregate = await this.prisma.usageLedger.aggregate({
      where: {
        tenantId,
        recordedAt: {
          gte: fromDate,
          lte: toDate,
        },
      },
      _sum: {
        estimatedCostUsd: true,
      },
    });

    const totalCostUsd = Number(usageAggregate._sum.estimatedCostUsd ?? 0);
    const costPerRun =
      totalRuns > 0 ? Number((totalCostUsd / totalRuns).toFixed(4)) : 0;

    return {
      window: { from: fromDate.toISOString(), to: toDate.toISOString() },
      totalRuns,
      runsByOutcome,
      runsByStatus,
      autoSyncRate,
      approvalRate,
      editRate,
      averageConfidence,
      estimatedMinutesSaved,
      manualMinutesPerUpdate,
      totalCostUsd: Number(totalCostUsd.toFixed(4)),
      costPerRun,
      dailyBuckets,
      repsActivity,
    };
  }

  /**
   * GET /v1/app/onboarding/status - Checks HubSpot, WhatsApp, linked reps, and first run
   */
  async getOnboardingStatus(tenantId: string): Promise<OnboardingStatusDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        hubspotAccessToken: true,
        hubspotPortalId: true,
        whatsappAccessToken: true,
        whatsappPhoneId: true,
        autoSyncThreshold: true,
        manualMinutesPerUpdate: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant "${tenantId}" not found`);
    }

    const [totalRepsCount, repsLinkedCount, firstRun] = await Promise.all([
      this.prisma.tenantRep.count({ where: { tenantId } }),
      this.prisma.tenantRep.count({
        where: {
          tenantId,
          whatsappPhone: { not: null },
          isActive: true,
        },
      }),
      this.prisma.workflowRun.findFirst({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true },
      }),
    ]);

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      hubspotConnected: Boolean(tenant.hubspotAccessToken),
      hubspotPortalId: tenant.hubspotPortalId,
      whatsappConnected: Boolean(tenant.whatsappAccessToken || tenant.whatsappPhoneId),
      whatsappPhoneId: tenant.whatsappPhoneId,
      repsLinkedCount,
      totalRepsCount,
      firstRunReceived: Boolean(firstRun),
      firstRunAt: firstRun?.createdAt ?? null,
      autoSyncThreshold: tenant.autoSyncThreshold,
      manualMinutesPerUpdate: tenant.manualMinutesPerUpdate,
    };
  }

  /**
   * GET /v1/app/settings
   * Returns workspace settings for the active tenant (NEVER reveals tokens).
   */
  async getTenantSettings(tenantId: string): Promise<TenantSettingsDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        name: true,
        slug: true,
        hubspotPortalId: true,
        hubspotAccessToken: true,
        whatsappPhoneId: true,
        whatsappAccessToken: true,
        fallbackApprovalPhone: true,
        autoSyncThreshold: true,
        manualMinutesPerUpdate: true,
        locale: true,
        timezone: true,
      },
    });

    if (!tenant) {
      throw new NotFoundException(`Tenant "${tenantId}" not found`);
    }

    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      hubspotPortalId: tenant.hubspotPortalId,
      hubspotConnected: Boolean(tenant.hubspotAccessToken),
      whatsappPhoneId: tenant.whatsappPhoneId,
      whatsappConnected: Boolean(tenant.whatsappAccessToken || tenant.whatsappPhoneId),
      fallbackApprovalPhone: tenant.fallbackApprovalPhone,
      autoSyncThreshold: tenant.autoSyncThreshold,
      manualMinutesPerUpdate: tenant.manualMinutesPerUpdate,
      locale: tenant.locale,
      timezone: tenant.timezone,
    };
  }

  /**
   * PATCH /v1/app/settings
   * Updates workspace settings. If rawWhatsAppToken is supplied, it is sealed at rest via EnvelopeCryptoService.
   */
  async updateTenantSettings(
    tenantId: string,
    actorUserId: string | null,
    body: UpdateTenantSettingsDto,
  ): Promise<TenantSettingsDto> {
    const existing = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!existing) {
      throw new NotFoundException(`Tenant "${tenantId}" not found`);
    }

    const data: Record<string, any> = {};

    if (body.name !== undefined) {
      data.name = body.name.trim();
    }

    if (body.autoSyncThreshold !== undefined) {
      if (
        typeof body.autoSyncThreshold !== 'number' ||
        body.autoSyncThreshold < 0 ||
        body.autoSyncThreshold > 100
      ) {
        throw new BadRequestException('autoSyncThreshold must be a number between 0 and 100');
      }
      data.autoSyncThreshold = Math.round(body.autoSyncThreshold);
    }

    if (body.manualMinutesPerUpdate !== undefined) {
      if (
        typeof body.manualMinutesPerUpdate !== 'number' ||
        body.manualMinutesPerUpdate < 1 ||
        body.manualMinutesPerUpdate > 120
      ) {
        throw new BadRequestException('manualMinutesPerUpdate must be a number between 1 and 120');
      }
      data.manualMinutesPerUpdate = Math.round(body.manualMinutesPerUpdate);
    }

    if (body.fallbackApprovalPhone !== undefined) {
      if (body.fallbackApprovalPhone === null || body.fallbackApprovalPhone.trim() === '') {
        data.fallbackApprovalPhone = null;
      } else {
        data.fallbackApprovalPhone = validateE164Phone(
          body.fallbackApprovalPhone,
          'fallbackApprovalPhone',
        );
      }
    }

    if (body.whatsappPhoneId !== undefined) {
      data.whatsappPhoneId = body.whatsappPhoneId?.trim() ? body.whatsappPhoneId.trim() : null;
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data,
      });
    }

    if (body.rawWhatsAppToken && body.rawWhatsAppToken.trim()) {
      await this.tokenManager.sealAndStoreTenantWhatsAppToken(
        tenantId,
        body.rawWhatsAppToken.trim(),
      );
    }

    await this.recordAuditLog({
      tenantId,
      actorUserId,
      action: 'settings.updated',
      targetType: 'Tenant',
      targetId: tenantId,
      meta: {
        updatedFields: Object.keys(data).concat(
          body.rawWhatsAppToken ? ['whatsappAccessToken'] : [],
        ),
      },
    });

    return this.getTenantSettings(tenantId);
  }

  private formatRunListItem(run: any, role: MembershipRole): RunListItemDto {
    const rawSenderPhone = (run.inputPayload as any)?.senderPhone ?? null;
    const maskedSenderPhone = formatPhoneNumberForRole(rawSenderPhone, role);

    const extracted = run.extractedData as Record<string, any> | null;
    let oneLineSummary = '';

    if (extracted?.summaryNote) {
      oneLineSummary = extracted.summaryNote.slice(0, 160);
    } else if (extracted?.dealName || extracted?.dealStage) {
      oneLineSummary = `${extracted.dealName || 'Deal'} -> ${extracted.dealStage || 'Stage'}${extracted.amount ? ` ($${extracted.amount})` : ''}`;
    } else if (run.errorMessage) {
      oneLineSummary = run.errorMessage.slice(0, 160);
    } else {
      oneLineSummary = `${run.workflowName} (${run.status})`;
    }

    const rep = run.decidedByRep
      ? {
          id: run.decidedByRep.id,
          fullName: run.decidedByRep.fullName,
          email: run.decidedByRep.email,
          whatsappPhone: formatPhoneNumberForRole(run.decidedByRep.whatsappPhone, role),
        }
      : null;

    return {
      id: run.id,
      workflowName: run.workflowName,
      externalDealId: run.externalDealId,
      status: run.status,
      outcome: run.outcome,
      confidenceScore: run.confidenceScore,
      senderPhone: maskedSenderPhone,
      oneLineSummary,
      overriddenFields: run.overriddenFields,
      errorMessage: run.errorMessage,
      decidedByRep: rep,
      decidedAt: run.decidedAt,
      undoneAt: run.undoneAt,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    };
  }

  private async recordAuditLog(params: {
    tenantId: string;
    actorUserId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    meta?: Record<string, any>;
  }): Promise<void> {
    if ((this.prisma as any).auditLog?.create) {
      await (this.prisma as any).auditLog.create({
        data: {
          tenantId: params.tenantId,
          actorUserId: params.actorUserId,
          action: params.action,
          targetType: params.targetType,
          targetId: params.targetId,
          meta: (params.meta ?? null) as any,
        },
      });
    }
  }
}

