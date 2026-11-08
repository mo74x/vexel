import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  createVexelSecurityExtension,
  TenantTransactionOptions,
} from './guards/tenant-rls.guard';

function createGuardedPrismaClient(base: PrismaClient) {
  return base.$extends(createVexelSecurityExtension(base));
}

// Export the exact inferred type so services can type-hint `GuardedPrismaClient`
export type GuardedPrismaClient = ReturnType<typeof createGuardedPrismaClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly baseClient = new PrismaClient();
  public readonly client: GuardedPrismaClient;

  constructor() {
    this.client = createGuardedPrismaClient(this.baseClient);
  }

  // Convenience getters so existing `this.prisma.tenant.update(...)` calls work seamlessly
  get tenant() {
    return this.client.tenant;
  }

  get tenantRep() {
    return this.client.tenantRep;
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

  get user() {
    return this.client.user;
  }

  get membership() {
    return this.client.membership;
  }

  get auditLog() {
    return this.client.auditLog;
  }

  get $withTenantTransaction() {
    return this.client.$withTenantTransaction;
  }

  async onModuleInit() {
    await this.baseClient.$connect();
  }

  async onModuleDestroy() {
    await this.baseClient.$disconnect();
  }
}
