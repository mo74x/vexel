import { StepStatus } from '@prisma/client';
import { VexelPrismaClient } from '@vexel/database';

export class AnvilStepContext {
  constructor(
    private readonly prisma: VexelPrismaClient,
    public readonly runId: string,
    public readonly tenantId: string,
  ) {}

  async run<T>(stepKey: string, fn: () => Promise<T>): Promise<T> {
    // 1. Single fast read to check deterministic replay cache
    const existing = await this.prisma.workflowStep.findUnique({
      where: { runId_stepKey: { runId: this.runId, stepKey } },
    });

    if (existing && existing.status === StepStatus.COMPLETED) {
      return existing.outputData as T;
    }

    const start = Date.now();
    try {
      // 2. Execute external I/O (Whisper, Claude, HubSpot) OUTSIDE DB transaction
      // so we never hold a pooled PostgreSQL connection idle during HTTP calls
      const result = await fn();
      const durationMs = Date.now() - start;

      // 3. Batch the step completion write + run progress pointer in ONE $withTenantTransaction
      await this.prisma.$withTenantTransaction(async (tx) => {
        await tx.workflowStep.upsert({
          where: { runId_stepKey: { runId: this.runId, stepKey } },
          update: {
            status: StepStatus.COMPLETED,
            outputData: result as any,
            durationMs,
            attempt: { increment: 1 },
          },
          create: {
            tenantId: this.tenantId,
            runId: this.runId,
            stepKey,
            status: StepStatus.COMPLETED,
            outputData: result as any,
            durationMs,
          },
        });

        await tx.workflowRun.update({
          where: { id: this.runId },
          data: {
            currentStepIdx: { increment: 1 },
            errorMessage: null,
          },
        });
      });

      return result;
    } catch (err: any) {
      if (err?.isRateLimitError === true || err?.name === 'HubSpotRateLimitError') {
        throw err;
      }

      // Batch step failure log + parent run error message in a single set_config round-trip
      await this.prisma.$withTenantTransaction(async (tx) => {
        await tx.workflowStep.upsert({
          where: { runId_stepKey: { runId: this.runId, stepKey } },
          update: {
            status: StepStatus.FAILED,
            errorLog: err?.message ?? 'Unknown error',
            attempt: { increment: 1 },
          },
          create: {
            tenantId: this.tenantId,
            runId: this.runId,
            stepKey,
            status: StepStatus.FAILED,
            errorLog: err?.message ?? 'Unknown error',
          },
        });

        await tx.workflowRun.update({
          where: { id: this.runId },
          data: { errorMessage: `[${stepKey}] ${err?.message ?? 'Step failed'}` },
        });
      });

      throw err;
    }
  }

  /**
   * Atomically evicts cached step outputs from PostgreSQL so downstream
   * schema drift errors can force upstream steps to re-compute on retry.
   */
  async invalidateSteps(stepKeys: string[], reason: string): Promise<number> {
    return this.prisma.$withTenantTransaction(async (tx) => {
      const deleted = await tx.workflowStep.deleteMany({
        where: {
          runId: this.runId,
          stepKey: { in: stepKeys },
        },
      });

      await tx.workflowRun.update({
        where: { id: this.runId },
        data: {
          errorMessage: `Self-healing cache eviction (${deleted.count} steps reset): ${reason}`,
        },
      });

      return deleted.count;
    });
  }
}
