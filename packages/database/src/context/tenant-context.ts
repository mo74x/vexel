import { AsyncLocalStorage } from 'async_hooks';
import { Prisma } from '@prisma/client';

export interface VexelTenantStore {
  tenantId: string | null;
  bypassRls?: boolean;
  activeTx?: Prisma.TransactionClient; // Pinned connection where set_config is already active
}

export const tenantStorage = new AsyncLocalStorage<VexelTenantStore>();

export class TenantContext {
  static run<T>(tenantId: string, fn: () => Promise<T>): Promise<T> {
    const current = tenantStorage.getStore();
    return tenantStorage.run(
      {
        tenantId,
        bypassRls: false,
        // Preserve activeTx only if re-entering with the exact same tenantId
        activeTx: current?.tenantId === tenantId ? current.activeTx : undefined,
      },
      fn,
    );
  }

  static runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
    const current = tenantStorage.getStore();
    return tenantStorage.run(
      {
        tenantId: null,
        bypassRls: true,
        activeTx: current?.bypassRls ? current.activeTx : undefined,
      },
      fn,
    );
  }

  static getStore(): VexelTenantStore | undefined {
    return tenantStorage.getStore();
  }
}