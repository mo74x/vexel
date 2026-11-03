import { PrismaClient, Prisma } from '@prisma/client';

// 2026 API Reference Pricing (USD)
const PRICING = {
  CLAUDE_SONNET_INPUT_PER_1M: 3.0,
  CLAUDE_SONNET_OUTPUT_PER_1M: 15.0,
  WHISPER_PER_SECOND: 0.006 / 60, // $0.006 per minute ($0.0001/sec)
};

export class UsageMeterService {
  constructor(private readonly prisma: PrismaClient) {}

  async recordLlmUsage(params: {
    tenantId: string;
    runId: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
  }): Promise<void> {
    const inputCost = (params.promptTokens / 1_000_000) * PRICING.CLAUDE_SONNET_INPUT_PER_1M;
    const outputCost = (params.completionTokens / 1_000_000) * PRICING.CLAUDE_SONNET_OUTPUT_PER_1M;
    const totalUsd = (inputCost + outputCost).toFixed(6);

    await this.prisma.usageLedger.create({
      data: {
        tenantId: params.tenantId,
        runId: params.runId,
        provider: params.provider,
        promptTokens: params.promptTokens,
        completionTokens: params.completionTokens,
        audioSeconds: 0,
        estimatedCostUsd: new Prisma.Decimal(totalUsd),
      },
    });
  }

  async recordAudioUsage(params: {
    tenantId: string;
    runId: string;
    provider: string;
    audioSeconds: number;
  }): Promise<void> {
    const totalUsd = (params.audioSeconds * PRICING.WHISPER_PER_SECOND).toFixed(6);

    await this.prisma.usageLedger.create({
      data: {
        tenantId: params.tenantId,
        runId: params.runId,
        provider: params.provider,
        promptTokens: 0,
        completionTokens: 0,
        audioSeconds: Math.ceil(params.audioSeconds),
        estimatedCostUsd: new Prisma.Decimal(totalUsd),
      },
    });
  }
}