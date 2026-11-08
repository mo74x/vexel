import { PipelineStageCacheService } from '../pipeline-stage-cache.service';

describe('PipelineStageCacheService', () => {
  const originalFetch = globalThis.fetch;
  let kvStore: Map<string, string>;
  let mockRedis: any;
  let service: PipelineStageCacheService;

  beforeEach(() => {
    kvStore = new Map<string, string>();
    mockRedis = {
      get: async (key: string) => kvStore.get(key) ?? null,
      set: async (key: string, val: string) => {
        kvStore.set(key, val);
        return 'OK';
      },
      del: async (key: string) => {
        kvStore.delete(key);
        return 1;
      },
    };
    service = new PipelineStageCacheService(mockRedis);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns default fallback stages when tenant has no HubSpot access token', async () => {
    const stages = await service.getTenantStages('tenant_1', null);
    expect(stages.length).toBe(7);
    expect(stages[0].id).toBe('appointmentscheduled');
  });

  it('fetches custom HubSpot pipeline stages on cache miss, sorts by displayOrder, caches in Redis, and supports invalidation', async () => {
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      return new Response(
        JSON.stringify({
          results: [
            {
              id: 'default',
              label: 'Enterprise Pipeline',
              stages: [
                {
                  id: 'stage_legal',
                  label: 'Legal Review',
                  displayOrder: 2,
                  metadata: { probability: '0.75' },
                },
                {
                  id: 'stage_discovery',
                  label: 'Discovery Call',
                  displayOrder: 1,
                  metadata: { probability: '0.25' },
                },
              ],
            },
          ],
        }),
        { status: 200 },
      );
    }) as any;

    const first = await service.getTenantStages('tenant_1', 'hs_tok_123', 'default');
    expect(fetchCalls).toBe(1);
    expect(first.map((s) => s.id)).toEqual(['stage_discovery', 'stage_legal']);
    expect(first[1].probability).toBe(0.75);

    // Second lookup hits Redis cache without network call
    const second = await service.getTenantStages('tenant_1', 'hs_tok_123', 'default');
    expect(fetchCalls).toBe(1);
    expect(second.length).toBe(2);

    // Invalidation clears cache key
    await service.invalidateTenantStages('tenant_1', 'default');
    expect(kvStore.size).toBe(0);
  });
});
