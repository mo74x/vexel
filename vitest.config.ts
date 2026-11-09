import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));

export default {
  resolve: {
    alias: {
      '@': resolve(rootDir, 'apps/web/src'),
      '@prisma/client': resolve(rootDir, 'packages/database/node_modules/@prisma/client'),
      '@vexel/database': resolve(rootDir, 'packages/database/src/index.ts'),
      '@vexel/anvil-engine': resolve(rootDir, 'packages/anvil-engine/src/runner.ts'),
      '@vexel/crm-hubspot': resolve(rootDir, 'packages/crm-hubspot/src/index.ts'),
      '@vexel/extractor': resolve(rootDir, 'packages/extractor/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/**/*.spec.{ts,tsx}', 'apps/**/*.spec.{ts,tsx}'],
  },
};
