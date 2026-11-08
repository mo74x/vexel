import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let cachedSpec: Record<string, any> | null = null;

export function getVexelOpenApiSpec(): Record<string, any> {
  if (cachedSpec) {
    return cachedSpec;
  }
  const specPath = resolve(__dirname, './vexel-app-api.openapi.json');
  try {
    const raw = readFileSync(specPath, 'utf8');
    cachedSpec = JSON.parse(raw);
    return cachedSpec!;
  } catch {
    // Fallback for tests or alternate working directory
    const altPath = resolve(process.cwd(), 'src/openapi/vexel-app-api.openapi.json');
    const raw = readFileSync(altPath, 'utf8');
    cachedSpec = JSON.parse(raw);
    return cachedSpec!;
  }
}

