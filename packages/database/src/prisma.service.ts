import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { encryptedTokenGuardExtension } from './extensions/encrypted-token-guard.extension';

function createGuardedPrismaClient() {
  return new PrismaClient().$extends(encryptedTokenGuardExtension);
}

// Export the exact inferred type so services can type-hint `GuardedPrismaClient`
export type GuardedPrismaClient = ReturnType<typeof createGuardedPrismaClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly baseClient = new PrismaClient();
  public readonly client: GuardedPrismaClient;

  constructor() {
    this.client = this.baseClient.$extends(encryptedTokenGuardExtension);
  }

  // Convenience getters so existing `this.prisma.tenant.update(...)` calls work seamlessly
  get tenant() {
    return this.client.tenant;
  }

  get workflowRun() {
    return this.client.workflowRun;
  }

  get workflowStep() {
    return this.client.workflowStep;
  }

  get usageLedger() {
    return this.client.usageLedger;
  }

  async onModuleInit() {
    await this.baseClient.$connect();
  }

  async onModuleDestroy() {
    await this.baseClient.$disconnect();
  }
}