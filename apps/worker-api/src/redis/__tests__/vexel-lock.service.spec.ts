import { VexelLockService } from '../vexel-lock.service';

describe('VexelLockService', () => {
  let kvStore: Map<string, string>;
  let listStore: Map<string, string[]>;
  let service: VexelLockService;

  beforeEach(() => {
    kvStore = new Map<string, string>();
    listStore = new Map<string, string[]>();

    service = Object.create(VexelLockService.prototype);
    (service as any).flushBufferLua = 'flush';
    (service as any).releaseLockLua = 'release';
    (service as any).extendLockLua = 'extend';
    (service as any).redis = {
      set: async (key: string, val: string, _mode: string, _ttl: number, nx?: string) => {
        if (nx === 'NX' && kvStore.has(key)) {
          return null;
        }
        kvStore.set(key, val);
        return 'OK';
      },
      rpush: async (key: string, val: string) => {
        const list = listStore.get(key) ?? [];
        list.push(val);
        listStore.set(key, list);
        return list.length;
      },
      expire: async () => 1,
      eval: async (script: string, _numKeys: number, key: string, arg1?: string) => {
        if (script === 'flush') {
          const items = listStore.get(key) ?? [];
          listStore.delete(key);
          return items;
        }
        if (script === 'extend') {
          return kvStore.get(key) === arg1 ? 1 : 0;
        }
        if (script === 'release') {
          if (kvStore.get(key) === arg1) {
            kvStore.delete(key);
            return 1;
          }
          return 0;
        }
        return 0;
      },
      quit: async () => 'OK',
    };
  });

  it('deduplicates webhook events via SET NX EX claimIdempotencyKey', async () => {
    const first = await service.claimIdempotencyKey('tenant_1', 'hash_abc');
    const second = await service.claimIdempotencyKey('tenant_1', 'hash_abc');
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it('buffers inbound messages in order and atomically flushes the buffer via Lua', async () => {
    await service.appendToBuffer('tenant_1', '+201001112222', {
      messageId: 'm1',
      senderPhone: '+201001112222',
      type: 'text',
      text: 'First message',
      timestamp: 1000,
    });
    const count = await service.appendToBuffer('tenant_1', '+201001112222', {
      messageId: 'm2',
      senderPhone: '+201001112222',
      type: 'text',
      text: 'Second message',
      timestamp: 2000,
    });
    expect(count).toBe(2);

    const flushed = await service.flushBuffer('tenant_1', '+201001112222');
    expect(flushed.map((m) => m.messageId)).toEqual(['m1', 'm2']);

    const secondFlush = await service.flushBuffer('tenant_1', '+201001112222');
    expect(secondFlush.length).toBe(0);
  });

  it('acquires, extends, and releases deal locks strictly for the lockToken owner', async () => {
    const token1 = await service.acquireDealLock('tenant_1', 'deal_99');
    expect(typeof token1).toBe('string');

    // Contending caller is blocked while lock is held
    const contending = await service.acquireDealLock('tenant_1', 'deal_99');
    expect(contending).toBeNull();

    // Wrong token cannot extend or release the lock
    expect(await service.extendDealLock('tenant_1', 'deal_99', 'wrong_token')).toBe(false);
    expect(await service.extendDealLock('tenant_1', 'deal_99', token1!)).toBe(true);

    await service.releaseDealLock('tenant_1', 'deal_99', 'wrong_token');
    expect(await service.acquireDealLock('tenant_1', 'deal_99')).toBeNull();

    // Legitimate owner releases lock
    await service.releaseDealLock('tenant_1', 'deal_99', token1!);
    const reacquired = await service.acquireDealLock('tenant_1', 'deal_99');
    expect(typeof reacquired).toBe('string');
  });
});

