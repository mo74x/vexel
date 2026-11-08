import { TenantContext } from '../../context/tenant-context';
import {
  CrossTenantAccessError,
  MissingTenantContextError,
} from '../tenant-rls.guard';

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
