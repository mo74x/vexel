import { Prisma, PrismaClient } from '@prisma/client';
import { tenantStorage, TenantContext } from '../context/tenant-context';
import { assertEncryptedTokenPayloads } from './token-envelope.guard';

export interface TenantTransactionOptions {
  tenantId?: string;
  maxWait?: number;
  timeout?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

export class MissingTenantContextError extends Error {
  constructor(model: string, operation: string) {
    super(
      `[TENANT_ISOLATION_VIOLATION] Blocked ${model}.${operation}: No active TenantContext. Wrap in TenantContext.run() or prisma.$withTenantTransaction().`,
    );
    this.name = 'MissingTenantContextError';
  }
}

export class CrossTenantAccessError extends Error {
  constructor(model: string, operation: string, expectedTenantId: string) {
    super(
      `[TENANT_ISOLATION_VIOLATION] Blocked ${model}.${operation}: Record does not belong to active tenant "${expectedTenantId}".`,
    );
    this.name = 'CrossTenantAccessError';
  }
}

export class AppendOnlyModelError extends Error {
  constructor(model: string, operation: string) {
    super(
      `[AUDIT_LOG_IMMUTABLE] Blocked ${model}.${operation}: Model "${model}" is append-only and cannot be updated or deleted.`,
    );
    this.name = 'AppendOnlyModelError';
  }
}

const TENANT_SCOPED_MODELS = new Set([
  'TenantRep',
  'WorkflowRun',
  'WorkflowStep',
  'UsageLedger',
  'Membership',
  'AuditLog',
]);

const APPEND_ONLY_MODELS = new Set(['AuditLog']);

const APPEND_ONLY_FORBIDDEN_OPERATIONS = new Set([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

const WRITE_OPERATIONS = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'upsert',
]);

const WHERE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

function injectTenantIntoWriteData(
  data: unknown,
  tenantId: string,
  model: string,
  operation: string,
): void {
  if (!data || typeof data !== 'object') return;

  if (Array.isArray(data)) {
    for (const item of data) {
      injectTenantIntoWriteData(item, tenantId, model, operation);
    }
    return;
  }

  const record = data as Record<string, unknown>;
  if ('tenantId' in record && record.tenantId !== undefined && record.tenantId !== tenantId) {
    throw new CrossTenantAccessError(model, operation, tenantId);
  }
  if (!('tenant' in record)) {
    record.tenantId = tenantId;
  }
}

function injectTenantIntoWhere(
  args: Record<string, any>,
  tenantId: string,
  model: string,
  operation: string,
): void {
  args.where = args.where ?? {};
  if (
    args.where.tenantId !== undefined &&
    typeof args.where.tenantId === 'string' &&
    args.where.tenantId !== tenantId
  ) {
    throw new CrossTenantAccessError(model, operation, tenantId);
  }
  args.where.tenantId = tenantId;
}

function verifyPostReadTenantOwnership(
  model: string,
  operation: string,
  result: unknown,
  expectedTenantId?: string | null,
  bypassRls?: boolean,
): void {
  if (
    TENANT_SCOPED_MODELS.has(model) &&
    expectedTenantId &&
    !bypassRls &&
    (operation === 'findUnique' || operation === 'findUniqueOrThrow') &&
    result &&
    typeof result === 'object' &&
    'tenantId' in result &&
    (result as any).tenantId !== expectedTenantId
  ) {
    throw new CrossTenantAccessError(model, operation, expectedTenantId);
  }
}

export function createVexelSecurityExtension(basePrisma: PrismaClient) {
  return Prisma.defineExtension((client) => {
    /**
     * Opens a single PostgreSQL transaction, executes set_config() ONCE,
     * and routes all nested model & raw queries through the pinned connection.
     */
    const runWithTenantTransaction = async <T>(
      fn: (tx: typeof client) => Promise<T>,
      options?: TenantTransactionOptions,
    ): Promise<T> => {
      const currentStore = TenantContext.getStore();
      const targetTenantId = options?.tenantId ?? currentStore?.tenantId ?? null;
      const bypassRls = currentStore?.bypassRls ?? false;

      if (!targetTenantId && !bypassRls) {
        throw new MissingTenantContextError('$client', '$withTenantTransaction');
      }

      // Re-entrant fast path: if already inside an active transaction for this tenant, reuse it!
      if (
        currentStore?.activeTx &&
        currentStore.tenantId === targetTenantId &&
        currentStore.bypassRls === bypassRls
      ) {
        return fn(client);
      }

      return basePrisma.$transaction(
        async (rawTx) => {
          // Combine RLS tenant binding + transaction-scoped safety timeouts in ONE round-trip.
          // Passing `true` (is_local) ensures every setting resets automatically on COMMIT/ROLLBACK,
          // guaranteeing zero state leakage across PgBouncer transaction-mode connections.
          if (bypassRls) {
            await rawTx.$executeRaw`
              SELECT
                set_config('app.bypass_rls', 'on', true),
                set_config('app.current_tenant_id', '', true),
                set_config('statement_timeout', '8000', true),
                set_config('idle_in_transaction_session_timeout', '10000', true),
                set_config('lock_timeout', '4000', true)
            `;
          } else {
            await rawTx.$executeRaw`
              SELECT
                set_config('app.current_tenant_id', ${targetTenantId!}, true),
                set_config('app.bypass_rls', 'off', true),
                set_config('statement_timeout', '8000', true),
                set_config('idle_in_transaction_session_timeout', '10000', true),
                set_config('lock_timeout', '4000', true)
            `;
          }

          // 2. Proxy raw SQL helpers ($executeRaw / $queryRaw) to rawTx while keeping model guards on `client`
          const txProxy = new Proxy(client, {
            get(target, prop, receiver) {
              if (
                prop === '$executeRaw' ||
                prop === '$queryRaw' ||
                prop === '$executeRawUnsafe' ||
                prop === '$queryRawUnsafe'
              ) {
                return (rawTx as any)[prop].bind(rawTx);
              }
              return Reflect.get(target, prop, receiver);
            },
          });

          // 3. Bind rawTx to AsyncLocalStorage so both `tx.<model>` and `this.prisma.<model>` use it
          return tenantStorage.run(
            {
              tenantId: targetTenantId,
              bypassRls,
              activeTx: rawTx,
            },
            () => fn(txProxy),
          );
        },
        {
          maxWait: options?.maxWait ?? 15_000, // Matches pool_timeout headroom
          timeout: options?.timeout ?? 10_000, // Hard ceiling for interactive transaction duration
          isolationLevel: options?.isolationLevel,
        },
      );
    };

    return client.$extends({
      name: 'vexel-security-and-rls-guard',
      client: {
        $withTenantTransaction: runWithTenantTransaction,
      },
      query: {
        $allModels: {
          async $allOperations({ model, operation, args }) {
            const safeArgs = (args ?? {}) as Record<string, any>;

            // 0. Enforce append-only semantics on immutable models (e.g., AuditLog)
            if (
              APPEND_ONLY_MODELS.has(model) &&
              APPEND_ONLY_FORBIDDEN_OPERATIONS.has(operation)
            ) {
              throw new AppendOnlyModelError(model, operation);
            }

            // 1. Enforce AES-256-GCM envelope format on all Tenant OAuth token writes
            if (WRITE_OPERATIONS.has(operation)) {
              if (operation === 'upsert') {
                assertEncryptedTokenPayloads(safeArgs.create, model, 'upsert.create');
                assertEncryptedTokenPayloads(safeArgs.update, model, 'upsert.update');
              } else if ('data' in safeArgs) {
                assertEncryptedTokenPayloads(safeArgs.data, model, operation);
              }
            }

            const store = TenantContext.getStore();

            // 2. Enforce TenantContext and auto-inject tenantId into AST
            if (TENANT_SCOPED_MODELS.has(model)) {
              if (!store || (!store.tenantId && !store.bypassRls)) {
                throw new MissingTenantContextError(model, operation);
              }

              if (store.tenantId && !store.bypassRls) {
                const activeTenantId = store.tenantId;

                if (
                  operation === 'create' ||
                  operation === 'createMany' ||
                  operation === 'createManyAndReturn'
                ) {
                  injectTenantIntoWriteData(safeArgs.data, activeTenantId, model, operation);
                } else if (operation === 'upsert') {
                  injectTenantIntoWriteData(safeArgs.create, activeTenantId, model, 'upsert.create');
                  injectTenantIntoWhere(safeArgs, activeTenantId, model, 'upsert.where');
                }

                if (WHERE_OPERATIONS.has(operation)) {
                  injectTenantIntoWhere(safeArgs, activeTenantId, model, operation);
                }
              }
            }

            const delegateName = model.charAt(0).toLowerCase() + model.slice(1);

            // 3. FAST PATH: If already inside $withTenantTransaction, execute directly on pinned rawTx
            if (store?.activeTx) {
              const result = await (store.activeTx as any)[delegateName][operation](safeArgs);
              verifyPostReadTenantOwnership(
                model,
                operation,
                result,
                store.tenantId,
                store.bypassRls,
              );
              return result;
            }

            // 4. FALLBACK PATH: Standalone single query outside $withTenantTransaction
            // Automatically wraps the single query in a 1-shot RLS transaction
            return runWithTenantTransaction(async () => {
              const activeStore = TenantContext.getStore()!;
              const result = await (activeStore.activeTx as any)[delegateName][operation](safeArgs);
              verifyPostReadTenantOwnership(
                model,
                operation,
                result,
                activeStore.tenantId,
                activeStore.bypassRls,
              );
              return result;
            });
          },
        },
      },
    });
  });
}
