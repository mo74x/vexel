import { PrismaClient, StepStatus } from '@prisma/client';

export class AnvilStepContext {
  constructor(
    private readonly prisma: PrismaClient,
    public readonly runId: string,
    public readonly tenantId: string,
  ) {}

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
      throw err; // Bubbles up to BullMQ for exponential backoff retry
    }
  }
}