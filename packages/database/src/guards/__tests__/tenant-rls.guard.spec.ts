import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TenantContext } from '../../context/tenant-context';
import {
  AppendOnlyModelError,
  CrossTenantAccessError,
  MissingTenantContextError,
  createVexelSecurityExtension,
} from '../tenant-rls.guard';

function createMockGuardedPrisma() {
  const executedRawQueries: unknown[][] = [];
  const rawTxCalls: Array<{ model: string; operation: string; args: Record<string, any> }> = [];

  const mockRecords: Record<string, Record<string, any>> = {
    membership_alpha: {
      id: 'mem_1',
      userId: 'user_1',
      tenantId: 'tenant_alpha',
      role: 'ADMIN',
    },
    membership_beta: {
      id: 'mem_2',
      userId: 'user_2',
      tenantId: 'tenant_beta',
      role: 'MANAGER',
    },
    audit_alpha: {
      id: 'aud_1',
      tenantId: 'tenant_alpha',
      actorUserId: 'user_1',
      action: 'deal.approved',
      targetType: 'WorkflowRun',
      targetId: 'run_1',
      meta: { dealStage: 'closedwon' },
      createdAt: new Date('2026-11-08T12:00:00Z'),
    },
    audit_beta: {
      id: 'aud_2',
      tenantId: 'tenant_beta',
      actorUserId: 'user_2',
      action: 'rep.created',
      targetType: 'TenantRep',
      targetId: 'rep_9',
      meta: null,
      createdAt: new Date('2026-11-08T12:05:00Z'),
    },
  };

  const makeModelDelegate = (modelName: string) =>
    new Proxy(
      {},
      {
        get(_target, operation: string) {
          return async (args: Record<string, any>) => {
            rawTxCalls.push({ model: modelName, operation, args });

            if (modelName === 'membership') {
              if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
                const id = args?.where?.id;
                if (id === 'mem_1') return mockRecords.membership_alpha;
                if (id === 'mem_2') return mockRecords.membership_beta;
                return null;
              }
              if (operation === 'findMany') {
                const all = [mockRecords.membership_alpha, mockRecords.membership_beta];
                return all.filter((r) => !args?.where?.tenantId || r.tenantId === args.where.tenantId);
              }
              if (operation === 'create') {
                return { id: 'mem_new', ...args.data };
              }
            }

            if (modelName === 'auditLog') {
              if (operation === 'findUnique' || operation === 'findUniqueOrThrow') {
                const id = args?.where?.id;
                if (id === 'aud_1') return mockRecords.audit_alpha;
                if (id === 'aud_2') return mockRecords.audit_beta;
                return null;
              }
              if (operation === 'findMany') {
                const all = [mockRecords.audit_alpha, mockRecords.audit_beta];
                return all.filter((r) => !args?.where?.tenantId || r.tenantId === args.where.tenantId);
              }
              if (operation === 'create') {
                return { id: 'aud_new', ...args.data };
              }
            }

            if (modelName === 'user') {
              if (operation === 'findUnique') {
                return {
                  id: 'user_1',
                  email: args?.where?.email ?? 'admin@vexel.io',
                  name: 'Nour Admin',
                  locale: 'en',
                  isOperator: false,
                };
              }
            }

            return { ok: true, args };
          };
        },
      },
    );

  const rawTx = {
    $executeRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => {
      executedRawQueries.push([strings.join('?'), ...values]);
      return 1;
    },
    membership: makeModelDelegate('membership'),
    auditLog: makeModelDelegate('auditLog'),
    user: makeModelDelegate('user'),
    workflowRun: makeModelDelegate('workflowRun'),
    tenantRep: makeModelDelegate('tenantRep'),
  };

  const basePrisma: any = {
    $transaction: async (fn: (tx: any) => Promise<any>) => fn(rawTx),
    $extends(extensionFnOrObj: any) {
      if (typeof extensionFnOrObj === 'function') {
        return extensionFnOrObj(basePrisma);
      }
      const queryInterceptor = extensionFnOrObj.query?.$allModels?.$allOperations;
      const makeGuardedDelegate = (ModelName: string) =>
        new Proxy(
          {},
          {
            get(_target, operation: string) {
              return (args?: Record<string, any>) =>
                queryInterceptor({
                  model: ModelName,
                  operation,
                  args: args ? structuredClone(args) : {},
                  query: (modifiedArgs: any) =>
                    (rawTx as any)[ModelName.charAt(0).toLowerCase() + ModelName.slice(1)][
                      operation
                    ](modifiedArgs),
                });
            },
          },
        );

      return {
        ...extensionFnOrObj.client,
        membership: makeGuardedDelegate('Membership'),
        auditLog: makeGuardedDelegate('AuditLog'),
        user: makeGuardedDelegate('User'),
        workflowRun: makeGuardedDelegate('WorkflowRun'),
        tenantRep: makeGuardedDelegate('TenantRep'),
      };
    },
  };

  const guarded = basePrisma.$extends(createVexelSecurityExtension(basePrisma));
  return { guarded, rawTxCalls, executedRawQueries };
}

describe('TenantContext & Tenant Isolation Errors', () => {
  it('propagates tenantId across async boundaries via AsyncLocalStorage', async () => {
    const resolved = await TenantContext.run('tenant_alpha', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return TenantContext.getStore();
    });

    expect(resolved).toEqual({
      tenantId: 'tenant_alpha',
      bypassRls: false,
      activeTx: undefined,
    });
  });

  it('supports system-level RLS bypass context via runAsSystem and returns undefined outside active context', async () => {
    expect(TenantContext.getStore()).toBeUndefined();

    const store = await TenantContext.runAsSystem(async () => TenantContext.getStore());
    expect(store).toEqual({
      tenantId: null,
      bypassRls: true,
      activeTx: undefined,
    });
  });

  it('formats MissingTenantContextError and CrossTenantAccessError with model and operation metadata', () => {
    const missingErr = new MissingTenantContextError('WorkflowRun', 'findMany');
    expect(missingErr.message).toContain('Blocked WorkflowRun.findMany: No active TenantContext');

    const crossErr = new CrossTenantAccessError('TenantRep', 'update', 'tenant_alpha');
    expect(crossErr.message).toContain(
      'Blocked TenantRep.update: Record does not belong to active tenant "tenant_alpha"',
    );
  });
});

describe('RLS Guard for Admin UI Models (Membership, AuditLog, User)', () => {
  it('blocks Membership and AuditLog queries when no TenantContext is active', async () => {
    const { guarded } = createMockGuardedPrisma();

    await expect(guarded.membership.findMany()).rejects.toThrow(MissingTenantContextError);
    await expect(guarded.auditLog.findMany()).rejects.toThrow(MissingTenantContextError);
  });

  it('blocks cross-tenant reads for Membership and AuditLog (findMany & findUnique)', async () => {
    const { guarded } = createMockGuardedPrisma();

    await TenantContext.run('tenant_alpha', async () => {
      // 1. Scoped findMany only returns tenant_alpha rows and injects tenantId filter
      const memberships = await guarded.membership.findMany({});
      expect(memberships).toHaveLength(1);
      expect(memberships[0].tenantId).toBe('tenant_alpha');

      const logs = await guarded.auditLog.findMany({});
      expect(logs).toHaveLength(1);
      expect(logs[0].tenantId).toBe('tenant_alpha');

      // 2. Explicit cross-tenant where filter is blocked pre-query
      await expect(
        guarded.membership.findMany({ where: { tenantId: 'tenant_beta' } }),
      ).rejects.toThrow(CrossTenantAccessError);

      await expect(
        guarded.auditLog.findMany({ where: { tenantId: 'tenant_beta' } }),
      ).rejects.toThrow(CrossTenantAccessError);

      // 3. Post-read ownership check blocks findUnique of a record owned by tenant_beta
      await expect(
        guarded.membership.findUnique({ where: { id: 'mem_2' } }),
      ).rejects.toThrow(CrossTenantAccessError);

      await expect(
        guarded.auditLog.findUnique({ where: { id: 'aud_2' } }),
      ).rejects.toThrow(CrossTenantAccessError);

      // 4. Same-tenant findUnique succeeds
      const ownMembership = await guarded.membership.findUnique({ where: { id: 'mem_1' } });
      expect(ownMembership?.id).toBe('mem_1');

      const ownAuditLog = await guarded.auditLog.findUnique({ where: { id: 'aud_1' } });
      expect(ownAuditLog?.id).toBe('aud_1');
    });
  });

  it('auto-injects tenantId on create and blocks cross-tenant writes on Membership and AuditLog', async () => {
    const { guarded } = createMockGuardedPrisma();

    await TenantContext.run('tenant_alpha', async () => {
      const createdMembership = await guarded.membership.create({
        data: { userId: 'user_9', role: 'SUPPORT' },
      });
      expect(createdMembership.tenantId).toBe('tenant_alpha');

      const createdAudit = await guarded.auditLog.create({
        data: {
          actorUserId: 'user_9',
          action: 'settings.updated',
          targetType: 'Tenant',
          targetId: 'tenant_alpha',
        },
      });
      expect(createdAudit.tenantId).toBe('tenant_alpha');

      await expect(
        guarded.membership.create({
          data: { userId: 'user_9', tenantId: 'tenant_beta', role: 'ADMIN' },
        }),
      ).rejects.toThrow(CrossTenantAccessError);

      await expect(
        guarded.auditLog.create({
          data: {
            tenantId: 'tenant_beta',
            action: 'settings.updated',
            targetType: 'Tenant',
            targetId: 'tenant_beta',
          },
        }),
      ).rejects.toThrow(CrossTenantAccessError);
    });
  });

  it('enforces append-only immutability on AuditLog (blocks update, updateMany, delete, deleteMany, upsert)', async () => {
    const { guarded } = createMockGuardedPrisma();

    await TenantContext.run('tenant_alpha', async () => {
      await expect(
        guarded.auditLog.update({ where: { id: 'aud_1' }, data: { action: 'tampered' } }),
      ).rejects.toThrow(AppendOnlyModelError);

      await expect(
        guarded.auditLog.updateMany({ where: {}, data: { action: 'tampered' } }),
      ).rejects.toThrow(AppendOnlyModelError);

      await expect(
        guarded.auditLog.delete({ where: { id: 'aud_1' } }),
      ).rejects.toThrow(AppendOnlyModelError);

      await expect(
        guarded.auditLog.deleteMany({ where: {} }),
      ).rejects.toThrow(AppendOnlyModelError);

      await expect(
        guarded.auditLog.upsert({
          where: { id: 'aud_1' },
          create: { action: 'a', targetType: 'T', targetId: '1' },
          update: { action: 'b' },
        }),
      ).rejects.toThrow(AppendOnlyModelError);
    });
  });

  it('treats User as a global non-tenant-scoped table without injecting tenantId', async () => {
    const { guarded, rawTxCalls } = createMockGuardedPrisma();

    await TenantContext.run('tenant_alpha', async () => {
      const user = await guarded.user.findUnique({ where: { email: 'admin@vexel.io' } });
      expect(user.email).toBe('admin@vexel.io');

      const userCall = rawTxCalls.find((c) => c.model === 'user');
      expect(userCall?.args.where).toEqual({ email: 'admin@vexel.io' });
      expect(userCall?.args.where.tenantId).toBeUndefined();
    });
  });

  it('defines FORCE ROW LEVEL SECURITY, tenant isolation policies, and indexes in the migration SQL', () => {
    const migrationPath = resolve(
      __dirname,
      '../../../prisma/migrations/20261108_add_admin_ui_models_and_rls/migration.sql',
    );
    const sql = readFileSync(migrationPath, 'utf8');

    expect(sql).toContain('ALTER TABLE "Membership" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "Membership" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain('CREATE POLICY "vexel_membership_isolation" ON "Membership"');

    expect(sql).toContain('ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;');
    expect(sql).toContain('CREATE POLICY "vexel_audit_log_isolation" ON "AuditLog"');

    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "WorkflowRun_tenantId_createdAt_idx"');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "WorkflowRun_tenantId_outcome_idx"');
    expect(sql).toContain('CREATE TRIGGER trg_audit_log_append_only');
  });
});
