import { StepStatus } from '@prisma/client';
import { AnvilStepContext } from '../runner';

describe('AnvilStepContext', () => {
  let stepStore: Map<string, any>;
  let runUpdates: Array<any>;
  let mockPrisma: any;
  let anvil: AnvilStepContext;

  beforeEach(() => {
    stepStore = new Map<string, any>();
    runUpdates = [];

    const txClient = {
      workflowStep: {
        upsert: async ({ where, update, create }: any) => {
          const key = `${where.runId_stepKey.runId}:${where.runId_stepKey.stepKey}`;
          const next = stepStore.has(key) ? { ...stepStore.get(key), ...update } : create;
          stepStore.set(key, next);
          return next;
        },
        deleteMany: async ({ where }: any) => {
          let count = 0;
          for (const key of where.stepKey.in) {
            const composite = `${where.runId}:${key}`;
            if (stepStore.delete(composite)) {
              count += 1;
            }
          }
          return { count };
        },
      },
      workflowRun: {
        update: async ({ data }: any) => {
          runUpdates.push(data);
          return data;
        },
      },
    };

    mockPrisma = {
      workflowStep: {
        findUnique: async ({ where }: any) => {
          const key = `${where.runId_stepKey.runId}:${where.runId_stepKey.stepKey}`;
          return stepStore.get(key) ?? null;
        },
      },
      $withTenantTransaction: async (cb: any) => cb(txClient),
    };

    anvil = new AnvilStepContext(mockPrisma, 'run_100', 'tenant_acme');
  });

  it('executes step on cache miss, persists COMPLETED output, and returns cached output on replay without re-running fn', async () => {
    let executions = 0;
    const firstOut = await anvil.run('step-1-transcribe', async () => {
      executions += 1;
      return { mergedTranscript: 'Hello world' };
    });

    expect(firstOut).toEqual({ mergedTranscript: 'Hello world' });
    expect(executions).toBe(1);
    expect(stepStore.get('run_100:step-1-transcribe')?.status).toBe(StepStatus.COMPLETED);

    // Second invocation hits deterministic replay cache
    const secondOut = await anvil.run('step-1-transcribe', async () => {
      executions += 1;
      return { mergedTranscript: 'Should not execute' };
    });

    expect(secondOut).toEqual({ mergedTranscript: 'Hello world' });
    expect(executions).toBe(1);
  });

  it('records StepStatus.FAILED and parent run errorMessage when step throws a non-rate-limit error', async () => {
    await expect(
      anvil.run('step-3-extract', async () => {
        throw new Error('Claude validation failed');
      }),
    ).rejects.toThrow(/Claude validation failed/);

    const failedStep = stepStore.get('run_100:step-3-extract');
    expect(failedStep?.status).toBe(StepStatus.FAILED);
    expect(failedStep?.errorLog).toBe('Claude validation failed');
    expect(runUpdates[0]?.errorMessage).toContain('[step-3-extract] Claude validation failed');
  });

  it('rethrows HubSpotRateLimitError immediately without marking step FAILED in PostgreSQL', async () => {
    const rateErr: any = new Error('HubSpot 429 burst limit');
    rateErr.isRateLimitError = true;

    await expect(
      anvil.run('step-5-sync', async () => {
        throw rateErr;
      }),
    ).rejects.toThrow(/HubSpot 429 burst limit/);

    expect(stepStore.has('run_100:step-5-sync')).toBe(false);
  });

  it('evicts specified step keys on invalidateSteps for self-healing schema drift recovery', async () => {
    await anvil.run('step-3-extract', async () => ({ dealStage: 'old_stage' }));
    expect(stepStore.has('run_100:step-3-extract')).toBe(true);

    const deletedCount = await anvil.invalidateSteps(
      ['step-3-extract'],
      'Stale HubSpot stage ID',
    );
    expect(deletedCount).toBe(1);
    expect(stepStore.has('run_100:step-3-extract')).toBe(false);
    expect(runUpdates[runUpdates.length - 1]?.errorMessage).toContain(
      'Self-healing cache eviction',
    );
  });
});

