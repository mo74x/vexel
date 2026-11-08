import { HubSpotHttpClient } from '../hubspot-http.client';
import {
  HubSpotRateLimitError,
  parseHubSpotRateLimitHeaders,
} from '../../errors/rate-limit.error';

describe('HubSpotHttpClient & Rate-Limit Backpressure', () => {
  const originalFetch = globalThis.fetch;
  let cooldownPttl = -2;
  let cooldownSaved: { key: string; val: string; ttl: number } | null = null;
  let mockRedis: any;
  let mockTokenManager: any;
  let client: HubSpotHttpClient;

  beforeEach(() => {
    cooldownPttl = -2;
    cooldownSaved = null;

    mockRedis = {
      pttl: async () => cooldownPttl,
      set: async (key: string, val: string, _px: string, ttl: number) => {
        cooldownSaved = { key, val, ttl };
        return 'OK';
      },
    };

    mockTokenManager = {
      calls: [] as boolean[],
      getValidAccessToken: async (_tenantId: string, forceRefresh = false) => {
        mockTokenManager.calls.push(forceRefresh);
        return forceRefresh ? 'fresh_rotated_token' : 'cached_token';
      },
    };

    client = new HubSpotHttpClient(mockRedis, mockTokenManager);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses HubSpot rate-limit headers for burst, Retry-After seconds, and daily quota exhaustion', () => {
    const retryHeaders = new Headers({
      'retry-after': '10',
      'x-hubspot-ratelimit-remaining': '0',
      'x-hubspot-ratelimit-secondly-remaining': '0',
    });
    const retryTelemetry = parseHubSpotRateLimitHeaders(retryHeaders);
    expect(retryTelemetry.kind).toBe('SECONDLY');
    expect(retryTelemetry.retryAfterMs >= 10_000).toBe(true);

    const dailyHeaders = new Headers({
      'x-hubspot-ratelimit-daily-remaining': '0',
    });
    const dailyTelemetry = parseHubSpotRateLimitHeaders(dailyHeaders);
    expect(dailyTelemetry.kind).toBe('DAILY_QUOTA');
    expect(dailyTelemetry.retryAfterMs >= 3_600_000).toBe(true);
  });

  it('transparently rotates token and replays request once on HTTP 401 Unauthorized', async () => {
    let attempt = 0;
    globalThis.fetch = (async (_url: any, init: any) => {
      attempt += 1;
      if (attempt === 1) {
        expect(init.headers.Authorization).toBe('Bearer cached_token');
        return new Response(JSON.stringify({ message: 'Expired' }), { status: 401 });
      }
      expect(init.headers.Authorization).toBe('Bearer fresh_rotated_token');
      return new Response(JSON.stringify({ id: 'deal_1' }), { status: 200 });
    }) as any;

    const res = await client.request({
      tenantId: 'tenant_1',
      path: '/crm/v3/objects/deals/deal_1',
    });

    expect(res.status).toBe(200);
    expect(res.data).toEqual({ id: 'deal_1' });
    expect(mockTokenManager.calls).toEqual([false, true]);
  });

  it('arms Redis tenant cooldown key and throws HubSpotRateLimitError on HTTP 429 or active pre-flight cooldown', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'retry-after': '5', 'x-hubspot-ratelimit-remaining': '0' },
      })) as any;

    let caught429: any = null;
    try {
      await client.request({ tenantId: 'tenant_1', path: '/crm/v3/objects/deals' });
    } catch (err) {
      caught429 = err;
    }

    expect(caught429 instanceof HubSpotRateLimitError).toBe(true);
    expect(cooldownSaved?.key).toBe('vexel:hs:cooldown:tenant_1');

    // Pre-flight cooldown gate blocks HTTP call before touching network
    cooldownPttl = 4000;
    await expect(
      client.request({ tenantId: 'tenant_1', path: '/crm/v3/objects/deals' }),
    ).rejects.toThrow(/PROACTIVE_LOW_REMAINING/);
  });
});

