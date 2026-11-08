import { Prisma } from '@prisma/client';

const PROTECTED_TOKEN_FIELDS = [
  'hubspotAccessToken',
  'hubspotRefreshToken',
  'whatsappAccessToken',
] as const;

type ProtectedTokenField = (typeof PROTECTED_TOKEN_FIELDS)[number];

const ENVELOPE_PREFIX = 'vexel:enc:';
// Matches: vexel:enc:v1:<base64url-wrapped-dek>:<base64url-cipher-bundle>
const STRICT_ENVELOPE_REGEX = /^vexel:enc:v\d+:[A-Za-z0-9_-]{36,}:[A-Za-z0-9_-]{36,}$/;

export class UnencryptedTokenWriteError extends Error {
  public readonly isSecurityViolation = true;

  constructor(
    public readonly model: string,
    public readonly operation: string,
    public readonly field: ProtectedTokenField,
    public readonly reason: string,
  ) {
    super(
      `[SECURITY_GUARD_VIOLATION] Blocked unencrypted write to Tenant.${field} during ${model}.${operation}: ${reason}`,
    );
    this.name = 'UnencryptedTokenWriteError';
  }
}

/**
 * Extracts raw string from either a direct assignment (`"..."`)
 * or Prisma's StringFieldUpdateOperationsInput (`{ set: "..." }`).
 */
function extractStringValue(input: unknown): string | null | undefined {
  if (input === null || input === undefined) {
    return input;
  }
  if (typeof input === 'string') {
    return input;
  }
  if (typeof input === 'object' && 'set' in (input as Record<string, unknown>)) {
    const setVal = (input as { set?: unknown }).set;
    if (setVal === null || setVal === undefined || typeof setVal === 'string') {
      return setVal;
    }
  }
  return undefined;
}

/**
 * Validates that any non-null token field on a Tenant data payload
 * starts with 'vexel:enc:' and conforms to the 5-part GCM envelope format.
 */
export function assertTenantPayloadSealed(
  payload: unknown,
  model: string,
  operation: string,
): void {
  if (!payload || typeof payload !== 'object') {
    return;
  }

  // Handle batch arrays (e.g., createMany / createManyAndReturn)
  if (Array.isArray(payload)) {
    for (const item of payload) {
      assertTenantPayloadSealed(item, model, operation);
    }
    return;
  }

  const record = payload as Record<string, unknown>;

  for (const field of PROTECTED_TOKEN_FIELDS) {
    if (!(field in record)) {
      continue;
    }

    const candidate = extractStringValue(record[field]);

    // Allow null or undefined (e.g., initial Tenant creation prior to OAuth, or OAuth disconnect)
    if (candidate === null || candidate === undefined) {
      continue;
    }

    if (!candidate.startsWith(ENVELOPE_PREFIX)) {
      throw new UnencryptedTokenWriteError(
        model,
        operation,
        field,
        `Value does not start with required "${ENVELOPE_PREFIX}" prefix.`,
      );
    }

    if (!STRICT_ENVELOPE_REGEX.test(candidate)) {
      throw new UnencryptedTokenWriteError(
        model,
        operation,
        field,
        'Value starts with "vexel:enc:" but is missing valid <kekVersion>:<wrappedDek>:<cipherBundle> segments.',
      );
    }
  }
}

/**
 * Inspects nested relational writes (e.g., workflowRun.create({ data: { tenant: { create: ... } } }))
 */
function assertNestedTenantWritesSealed(
  data: unknown,
  model: string,
  operation: string,
): void {
  if (!data || typeof data !== 'object') {
    return;
  }

  const record = data as Record<string, any>;
  const nestedTenant = record.tenant;
  if (!nestedTenant || typeof nestedTenant !== 'object') {
    return;
  }

  if (nestedTenant.create) {
    assertTenantPayloadSealed(nestedTenant.create, model, `${operation}->tenant.create`);
  }
  if (nestedTenant.update) {
    const updateTarget = nestedTenant.update.data ?? nestedTenant.update;
    assertTenantPayloadSealed(updateTarget, model, `${operation}->tenant.update`);
  }
  if (nestedTenant.upsert) {
    assertTenantPayloadSealed(nestedTenant.upsert.create, model, `${operation}->tenant.upsert.create`);
    assertTenantPayloadSealed(nestedTenant.upsert.update, model, `${operation}->tenant.upsert.update`);
  }
  if (nestedTenant.connectOrCreate?.create) {
    assertTenantPayloadSealed(
      nestedTenant.connectOrCreate.create,
      model,
      `${operation}->tenant.connectOrCreate.create`,
    );
  }
}

/**
 * Prisma Client Extension that enforces AES-256-GCM envelope encryption on all Tenant token writes.
 */
export const encryptedTokenGuardExtension = Prisma.defineExtension({
  name: 'vexel-encrypted-token-guard',
  query: {
    tenant: {
      async create({ args, query }) {
        assertTenantPayloadSealed(args.data, 'Tenant', 'create');
        return query(args);
      },
      async createMany({ args, query }) {
        assertTenantPayloadSealed(args.data, 'Tenant', 'createMany');
        return query(args);
      },
      async createManyAndReturn({ args, query }) {
        assertTenantPayloadSealed(args.data, 'Tenant', 'createManyAndReturn');
        return query(args);
      },
      async update({ args, query }) {
        assertTenantPayloadSealed(args.data, 'Tenant', 'update');
        return query(args);
      },
      async updateMany({ args, query }) {
        assertTenantPayloadSealed(args.data, 'Tenant', 'updateMany');
        return query(args);
      },
      async upsert({ args, query }) {
        assertTenantPayloadSealed(args.create, 'Tenant', 'upsert.create');
        assertTenantPayloadSealed(args.update, 'Tenant', 'upsert.update');
        return query(args);
      },
    },
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        // Inspect non-Tenant write operations for nested `tenant: { create | update | upsert }`
        if (
          model &&
          model !== 'Tenant' &&
          (operation === 'create' || operation === 'update' || operation === 'upsert')
        ) {
          const anyArgs = args as Record<string, any>;
          if (operation === 'upsert') {
            assertNestedTenantWritesSealed(anyArgs.create, model, 'upsert.create');
            assertNestedTenantWritesSealed(anyArgs.update, model, 'upsert.update');
          } else {
            assertNestedTenantWritesSealed(anyArgs.data, model, operation);
          }
        }
        return query(args);
      },
    },
  },
});