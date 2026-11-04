import { PrismaClient } from '@prisma/client';
import { vexelEncryptedTokenGuard } from './guards/token-envelope.guard';

function createExtendedPrismaClient() {
  const baseClient = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  return baseClient.$extends(vexelEncryptedTokenGuard);
}

// Export the inferred type for NestJS Dependency Injection
export type VexelPrismaClient = ReturnType<typeof createExtendedPrismaClient>;

const globalForPrisma = globalThis as unknown as {
  vexelPrisma?: VexelPrismaClient;
};

export const prisma: VexelPrismaClient =
  globalForPrisma.vexelPrisma ?? createExtendedPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.vexelPrisma = prisma;
}