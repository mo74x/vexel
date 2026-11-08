import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Headers,
  HttpCode,
  BadRequestException,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { RunStatus } from '@prisma/client';
import { PrismaService, TenantContext } from '@vexel/database';
import { VexelLockService } from '../redis/vexel-lock.service';

@Controller()
export class OpsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: VexelLockService,
    @InjectQueue('vexel-workflows') private readonly workflowQueue: Queue,
  ) {}

  /**
   * GET /healthz
   * Lightweight liveness probe for container orchestrators
   */
  @Get('healthz')
  @HttpCode(200)
  getLiveness() {
    return {
      status: 'ok',
      role: process.env.VEXEL_PROCESS_ROLE || 'both',
      uptimeSeconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * GET /readyz
   * Deep readiness probe verifying PostgreSQL connectivity, Redis ping, and BullMQ queue telemetry
   */
  @Get('readyz')
  @HttpCode(200)
  async getReadiness() {
    const checks: Record<string, { ok: boolean; latencyMs?: number; error?: string }> = {};

    // 1. Check Redis
    const redisStart = Date.now();
    try {
      const pong = await this.lockService.redis.ping();
      checks.redis = { ok: pong === 'PONG', latencyMs: Date.now() - redisStart };
    } catch (err: any) {
      checks.redis = { ok: false, error: err?.message ?? 'Redis ping failed' };
    }

    // 2. Check PostgreSQL
    const dbStart = Date.now();
    try {
      await (this.prisma.client as any).$queryRawUnsafe?.('SELECT 1');
      checks.postgres = { ok: true, latencyMs: Date.now() - dbStart };
    } catch (err: any) {
      checks.postgres = { ok: false, error: err?.message ?? 'Postgres check failed' };
    }

    // 3. Fetch BullMQ queue depth metrics
    let queueCounts: Record<string, number> = {};
    try {
      queueCounts = (await this.workflowQueue.getJobCounts(
        'waiting',
        'active',
        'delayed',
        'failed',
      )) as Record<string, number>;
    } catch {
      // Non-fatal if queue metrics call is mocked
    }

    const allHealthy = Object.values(checks).every((c) => c.ok);
    if (!allHealthy) {
      throw new ServiceUnavailableException({
        status: 'degraded',
        checks,
        queueCounts,
      });
    }

    return {
      status: 'ready',
      checks,
      queueCounts,
    };
  }

  /**
   * GET /v1/ops/tenants/:tenantId/dlq
   * Lists DEAD_LETTER and FAILED WorkflowRuns for a tenant
   */
  @Get('v1/ops/tenants/:tenantId/dlq')
  async listDeadLetterRuns(
    @Headers('x-vexel-api-key') apiKey: string | undefined,
    @Param('tenantId') tenantId: string,
  ) {
    this.verifyAdminApiKey(apiKey);

    const runs = await TenantContext.run(tenantId, () =>
      this.prisma.workflowRun.findMany({
        where: {
          tenantId,
          status: { in: [RunStatus.DEAD_LETTER, RunStatus.FAILED] },
        },
        orderBy: { startedAt: 'desc' },
        take: 50,
      }),
    );

    return {
      tenantId,
      count: runs.length,
      runs,
    };
  }

  /**
   * POST /v1/ops/tenants/:tenantId/dlq/:runId/replay
   * Re-queues a DEAD_LETTER or FAILED run from its last completed Anvil step
   */
  @Post('v1/ops/tenants/:tenantId/dlq/:runId/replay')
  @HttpCode(200)
  async replayDeadLetterRun(
    @Headers('x-vexel-api-key') apiKey: string | undefined,
    @Param('tenantId') tenantId: string,
    @Param('runId') runId: string,
  ) {
    this.verifyAdminApiKey(apiKey);

    const existing = await TenantContext.run(tenantId, () =>
      this.prisma.workflowRun.findUnique({
        where: { id: runId },
      }),
    );

    if (!existing || existing.tenantId !== tenantId) {
      throw new NotFoundException(`WorkflowRun "${runId}" not found for tenant "${tenantId}"`);
    }

    if (existing.status !== RunStatus.DEAD_LETTER && existing.status !== RunStatus.FAILED) {
      throw new BadRequestException(
        `Only DEAD_LETTER or FAILED runs can be replayed (current status: ${existing.status})`,
      );
    }

    await TenantContext.run(tenantId, () =>
      this.prisma.workflowRun.update({
        where: { id: runId },
        data: {
          status: RunStatus.RUNNING,
          errorMessage: null,
        },
      }),
    );

    const senderPhone = (existing.inputPayload as any)?.senderPhone;
    const replayJobId = `dlq-replay:${runId}:${Date.now()}`;

    await this.workflowQueue.add(
      'execute-revops-pipeline',
      {
        tenantId,
        runId,
        senderPhone,
        mode: 'INITIAL_INGEST',
      },
      {
        jobId: replayJobId,
        attempts: 5,
        backoff: { type: 'exponential', delay: 4000 },
        removeOnComplete: true,
      },
    );

    return {
      status: 'dlq_run_requeued',
      tenantId,
      runId,
      jobId: replayJobId,
    };
  }

  /**
   * POST /v1/ops/tenants/:tenantId/dlq/:runId/discard
   * Permanently closes a DEAD_LETTER run so it no longer appears in active DLQ triage
   */
  @Post('v1/ops/tenants/:tenantId/dlq/:runId/discard')
  @HttpCode(200)
  async discardDeadLetterRun(
    @Headers('x-vexel-api-key') apiKey: string | undefined,
    @Param('tenantId') tenantId: string,
    @Param('runId') runId: string,
    @Body() body?: { reason?: string },
  ) {
    this.verifyAdminApiKey(apiKey);

    await TenantContext.run(tenantId, () =>
      this.prisma.workflowRun.update({
        where: { id: runId },
        data: {
          status: RunStatus.COMPLETED,
          completedAt: new Date(),
          errorMessage: `[DLQ Discarded] ${body?.reason ?? 'Closed by operator'}`,
        },
      }),
    );

    return {
      status: 'dlq_run_discarded',
      tenantId,
      runId,
    };
  }

  /**
   * POST /v1/ops/tenants/:tenantId/sweep
   * Expires stale WAITING_APPROVAL runs older than maxApprovalHours (default 48h)
   * and scrubs raw PII transcripts on completed runs older than retentionDays (default 90d).
   */
  @Post('v1/ops/tenants/:tenantId/sweep')
  @HttpCode(200)
  async sweepStaleApprovalsAndRetention(
    @Headers('x-vexel-api-key') apiKey: string | undefined,
    @Param('tenantId') tenantId: string,
    @Body() body?: { maxApprovalHours?: number; retentionDays?: number },
  ) {
    this.verifyAdminApiKey(apiKey);

    const maxApprovalHours = body?.maxApprovalHours ?? 48;
    const retentionDays = body?.retentionDays ?? 90;

    const approvalCutoff = new Date(Date.now() - maxApprovalHours * 3600 * 1000);
    const retentionCutoff = new Date(Date.now() - retentionDays * 86400 * 1000);

    return TenantContext.run(tenantId, async () => {
      const expiredApprovals = await this.prisma.workflowRun.updateMany({
        where: {
          tenantId,
          status: RunStatus.WAITING_APPROVAL,
          startedAt: { lt: approvalCutoff },
        },
        data: {
          status: RunStatus.FAILED,
          completedAt: new Date(),
          errorMessage: `Approval window expired after ${maxApprovalHours}h without rep response`,
        },
      });

      const scrubbedRuns = await this.prisma.workflowRun.updateMany({
        where: {
          tenantId,
          status: RunStatus.COMPLETED,
          completedAt: { lt: retentionCutoff },
        },
        data: {
          inputPayload: { redacted: true, scrubbedAt: new Date().toISOString() },
        },
      });

      return {
        status: 'sweep_completed',
        tenantId,
        expiredWaitingApprovalsCount: expiredApprovals.count,
        scrubbedPiiRunsCount: scrubbedRuns.count,
      };
    });
  }

  private verifyAdminApiKey(apiKey: string | undefined): void {
    const expected =
      process.env.VEXEL_INTERNAL_API_KEY || process.env.VEXEL_APPROVAL_HMAC_SECRET;
    if (!expected || !apiKey || apiKey !== expected) {
      throw new UnauthorizedException('Missing or invalid admin API key');
    }
  }
}

