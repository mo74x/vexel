import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { encryptedTokenGuardExtension } from "./extensions/encrypted-token-guard.extension";

const connectionString = process.env.DATABASE_URL!;
const adapter = new PrismaPg({ connectionString });

function createExtendedPrisma() {
  return new PrismaClient({ adapter }).$extends(encryptedTokenGuardExtension);
}

const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createExtendedPrisma> | undefined;
};

export const prisma = globalForPrisma.prisma ?? createExtendedPrisma();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export * from "@prisma/client";
export * from "./extensions/encrypted-token-guard.extension";
export * from "./prisma.service";
