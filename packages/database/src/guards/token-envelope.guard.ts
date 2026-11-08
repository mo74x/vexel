import { Prisma } from '@prisma/client';

export class UnencryptedTokenWriteError extends Error {
  public readonly isSecurityViolation = true;

  constructor(
    public readonly model: string,
    public readonly operation: string,
    public readonly fieldName: string,
  ) {
    super(
      `[SECURITY_VIOLATION] Blocked ${model}.${operation}: Attempted to write unencrypted or malformed value to "${fieldName}". Value must be sealed via EnvelopeCryptoService ("vexel:enc:<version>:<dek>:<cipher>").`,
    );
    this.name = 'UnencryptedTokenWriteError';
  }
}

const PROTECTED_TOKEN_FIELDS = new Set([
  'hubspotAccessToken',
  'hubspotRefreshToken',
  'whatsappAccessToken',
]);

// Matches: vexel:enc:v1:<base64url_dek>:<base64url_cipher>
const ENVELOPE_REGEX = /^vexel:enc:v\d+:[A-Za-z0-9_-]{40,}:[A-Za-z0-9_-]{30,}$/;

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
]);

/**
 * Extracts raw string value whether passed directly ("...") or via Prisma ({ set: "..." })
 */
function extractCandidateString(val: unknown): string | null | undefined {
  if (val === null || val === undefined) {
    return val;
  }
  if (typeof val === 'string') {
    return val;
  }
  if (typeof val === 'object' && 'set' in (val as Record<string, unknown>)) {
    const inner = (val as { set?: unknown }).set;
    if (inner === null || inner === undefined || typeof inner === 'string') {
      return inner;
    }
  }
  return undefined;
}

/**
 * Recursively inspects mutation payloads (including arrays and nested Tenant writes)
 */
export function assertEncryptedTokenPayloads(
  payload: unknown,
  model: string,
  operation: string,
): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      assertEncryptedTokenPayloads(item, model, operation);
    }
    return;
  }

  const record = payload as Record<string, unknown>;

  for (const [key, value] of Object.entries(record)) {
    if (PROTECTED_TOKEN_FIELDS.has(key)) {
      const strValue = extractCandidateString(value);

      // Null/undefined is allowed (e.g., disconnecting OAuth or initial tenant creation)
      if (strValue !== null && strValue !== undefined) {
        if (!strValue.startsWith('vexel:enc:') || !ENVELOPE_REGEX.test(strValue)) {
          throw new UnencryptedTokenWriteError(model, operation, key);
        }
      }
    } else if (value && typeof value === 'object') {
      // Recurse into nested relation writes (e.g., tenant: { create: {...}, update: {...} })
      assertEncryptedTokenPayloads(value, model, operation);
    }
  }
}

/**
 * Prisma Client Extension enforcing AES-256-GCM envelope format on all Tenant token writes
 */
export const vexelEncryptedTokenGuard = Prisma.defineExtension({
  name: 'vexel-encrypted-token-guard',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (WRITE_OPERATIONS.has(operation) && args) {
          const writeArgs = args as Record<string, unknown>;

          if (operation === 'upsert') {
            assertEncryptedTokenPayloads(writeArgs.create, model, 'upsert.create');
            assertEncryptedTokenPayloads(writeArgs.update, model, 'upsert.update');
          } else if ('data' in writeArgs) {
            assertEncryptedTokenPayloads(writeArgs.data, model, operation);
          }
        }

        return query(args);
      },
    },
  },
});