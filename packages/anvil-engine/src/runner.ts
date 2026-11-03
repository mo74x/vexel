import { PrismaClient, StepStatus } from '@prisma/client';

export class AnvilStepContext {
  constructor(
    private readonly prisma: PrismaClient,
    public readonly runId: string,
    public readonly tenantId: string,
  ) { }

  async run<T>(stepKey: string, fn: () => Promise<T>): Promise<T> {
    const existing = await this.prisma.workflowStep.findUnique({
      where: { runId_stepKey: { runId: this.runId, stepKey } },
    });

    // Deterministic Replay: return cached output without re-executing
    if (existing && existing.status === StepStatus.COMPLETED) {
      return existing.outputData as T;
    }

    const start = Date.now();
    try {
      const result = await fn();
      const durationMs = Date.now() - start;

      await this.prisma.workflowStep.upsert({
        where: { runId_stepKey: { runId: this.runId, stepKey } },
        update: {
          status: StepStatus.COMPLETED,
          outputData: result as any,
          durationMs,
          attempt: { increment: 1 },
        },
        create: {
          runId: this.runId,
          stepKey,
          status: StepStatus.COMPLETED,
          outputData: result as any,
          durationMs,
        },
      });

      return result;
    } catch (err: any) {
      // Do not mark step as FAILED in PostgreSQL if pausing for rate-limit backoff
      if (err?.isRateLimitError === true || err?.name === 'HubSpotRateLimitError') {
        throw err;
      }
      await this.prisma.workflowStep.upsert({
        where: { runId_stepKey: { runId: this.runId, stepKey } },
        update: {
          status: StepStatus.FAILED,
          errorLog: err?.message ?? 'Unknown error',
          attempt: { increment: 1 },
        },
        create: {
          runId: this.runId,
          stepKey,
          status: StepStatus.FAILED,
          errorLog: err?.message ?? 'Unknown error',
        },
      });
      throw err;
    }
  }

  /**
     * Atomically evicts cached step outputs from PostgreSQL so downstream
     * schema drift errors can force upstream steps to re-compute on retry.
     */
  async invalidateSteps(stepKeys: string[], reason: string): Promise<number> {
    const deleted = await this.prisma.workflowStep.deleteMany({
      where: {
        runId: this.runId,
        stepKey: { in: stepKeys },
      },
    });

    await this.prisma.workflowRun.update({
      where: { id: this.runId },
      data: {
        errorMessage: `Self-healing cache eviction (${deleted.count} steps reset): ${reason}`,
      },
    });

    return deleted.count;
  }
}