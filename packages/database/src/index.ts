import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { createVexelSecurityExtension } from "./guards/tenant-rls.guard";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });

function createExtendedPrisma() {
  const base = new PrismaClient({ adapter });
  return base.$extends(createVexelSecurityExtension(base));
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createExtendedPrisma> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createExtendedPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
export * from "./context/tenant-context";
export * from "./guards/tenant-rls.guard";
export * from "./extensions/encrypted-token-guard.extension";
export {
  assertEncryptedTokenPayloads,
  vexelEncryptedTokenGuard,
} from "./guards/token-envelope.guard";
export type { VexelPrismaClient } from "./client";
export * from "./prisma.service";
