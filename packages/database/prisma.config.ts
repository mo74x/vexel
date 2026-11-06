  import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma 7 uses prisma.config.ts for CLI/migrations: prefer DIRECT_URL (unpooled) when set, falling back to DATABASE_URL
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      "postgresql://postgres@localhost:5432/vexel_core?schema=public",
  },
});
