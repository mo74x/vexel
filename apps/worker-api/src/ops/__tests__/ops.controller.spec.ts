import { RunStatus } from '@prisma/client';
import { OpsController } from '../ops.controller';
import { validateRuntimeEnv } from '../../config/env-validator';

describe('OpsController & Runtime Env Validator', () => {
  let mockPrisma: any;
  let mockLockService: any;
  let mockQueue: any;
  let queuedJobs: any[];
  let runStore: Map<string, any>;
  let controller: OpsController;

  beforeEach(() => {
    process.env.VEXEL_INTERNAL_API_KEY = 'ops_admin_secret_123';
    queuedJobs = [];
    runStore = new Map<string, any>([
      [
        'run_dead_1',
        {
          id: 'run_dead_1',
          tenantId: 'tenant_acme',
          status: RunStatus.DEAD_LETTER,
          inputPayload: { senderPhone: '+201001112222', messages: [] },
          errorMessage: 'HubSpot OAuth permanently revoked',
          startedAt: new Date(Date.now() - 3600_000),
        },
      ],
    ]);

    mockPrisma = {
      client: {
        $queryRawUnsafe: async () => [{ '?column?': 1 }],
      },
      workflowRun: {
        findMany: async () => Array.from(runStore.values()),
        findUnique: async ({ where }: any) => runStore.get(where.id) ?? null,
        update: async ({ where, data }: any) => {
          const existing = runStore.get(where.id);
          const updated = { ...existing, ...data };
          runStore.set(where.id, updated);
          return updated;
        },
        updateMany: async () => ({ count: 2 }),
      },
    };

    mockLockService = {
      redis: {
        ping: async () => 'PONG',
      },
    };

    mockQueue = {
      getJobCounts: async () => ({
        waiting: 1,
        active: 0,
        delayed: 2,
        failed: 0,
      }),
      add: async (name: string, data: any, opts: any) => {
        queuedJobs.push({ name, data, opts });
        return { id: opts.jobId };
      },
    };

    controller = new OpsController(mockPrisma, mockLockService, mockQueue);
  });

  it('validates boot environment variables and throws in strict/production mode when KEK is missing', () => {
    const validEnv = validateRuntimeEnv(
      {
        NODE_ENV: 'production',
        VEXEL_PROCESS_ROLE: 'api',
        VEXEL_KEK_V1: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        VEXEL_APPROVAL_HMAC_SECRET: 'super_secret_hmac_key_12345',
      },
      true,
    );
    expect(validEnv.valid).toBe(true);
    expect(validEnv.processRole).toBe('api');

    expect(() =>
      validateRuntimeEnv(
        {
          NODE_ENV: 'production',
          VEXEL_PROCESS_ROLE: 'worker',
          VEXEL_KEK_V1: 'short_invalid_key',
        },
        true,
      ),
    ).toThrow(/Vexel Boot Validation Failed/);
  });

  it('returns liveness on /healthz and deep readiness + queue telemetry on /readyz', async () => {
    const live = controller.getLiveness();
    expect(live.status).toBe('ok');

    const ready = await controller.getReadiness();
    expect(ready.status).toBe('ready');
    expect(ready.checks.redis.ok).toBe(true);
    expect(ready.checks.postgres.ok).toBe(true);
    expect(ready.queueCounts.delayed).toBe(2);
  });

  it('lists, replays, and discards DEAD_LETTER runs and sweeps stale approvals + PII retention', async () => {
    const dlqList = await controller.listDeadLetterRuns('ops_admin_secret_123', 'tenant_acme');
    expect(dlqList.count).toBe(1);

    const replayed = await controller.replayDeadLetterRun(
      'ops_admin_secret_123',
      'tenant_acme',
      'run_dead_1',
    );
    expect(replayed.status).toBe('dlq_run_requeued');
    expect(runStore.get('run_dead_1')?.status).toBe(RunStatus.RUNNING);
    expect(queuedJobs.length).toBe(1);

    const discarded = await controller.discardDeadLetterRun(
      'ops_admin_secret_123',
      'tenant_acme',
      'run_dead_1',
      { reason: 'Duplicate test run' },
    );
    expect(discarded.status).toBe('dlq_run_discarded');
    expect(runStore.get('run_dead_1')?.status).toBe(RunStatus.COMPLETED);

    const swept = await controller.sweepStaleApprovalsAndRetention(
      'ops_admin_secret_123',
      'tenant_acme',
      { maxApprovalHours: 24, retentionDays: 30 },
    );
    expect(swept).toEqual({
      status: 'sweep_completed',
      tenantId: 'tenant_acme',
      expiredWaitingApprovalsCount: 2,
      scrubbedPiiRunsCount: 2,
    });
  });
});

