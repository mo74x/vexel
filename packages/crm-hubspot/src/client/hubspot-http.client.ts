import Redis from 'ioredis';
import {
  HubSpotRateLimitError,
  parseHubSpotRateLimitHeaders,
} from '../errors/rate-limit.error';
import { HubSpotTokenManagerService } from '../auth/hubspot-token-manager.service';

export class HubSpotHttpClient {
  private readonly PROACTIVE_RESERVE_THRESHOLD = 2;

  constructor(
    private readonly redis: Redis,
    private readonly tokenManager: HubSpotTokenManagerService,
  ) {}

  private getCooldownKey(tenantId: string): string {
    return `vexel:hs:cooldown:${tenantId}`;
  }

  async request<T = any>(params: {
    tenantId: string;
    path: string;
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    body?: Record<string, any>;
    isRetryAfter401?: boolean;
  }): Promise<{ status: number; data: T; headers: Headers }> {
    const { tenantId, path, method = 'GET', body, isRetryAfter401 = false } = params;
    const cooldownKey = this.getCooldownKey(tenantId);

    // 1. Pre-flight rate-limit cooldown check
    const activeCooldownMs = await this.redis.pttl(cooldownKey);
    if (activeCooldownMs > 0) {
      const jitterMs = Math.floor(150 + Math.random() * 350);
      throw new HubSpotRateLimitError(tenantId, activeCooldownMs + jitterMs, {
        remainingBurst: 0,
        maxBurst: null,
        intervalMs: activeCooldownMs,
        dailyRemaining: null,
        retryAfterMs: activeCooldownMs + jitterMs,
        kind: 'PROACTIVE_LOW_REMAINING',
      });
    }

    // 2. Fetch valid token (or force single-flight mutex rotation if retrying after 401)
    const accessToken = await this.tokenManager.getValidAccessToken(
      tenantId,
      isRetryAfter401,
    );

    const url = path.startsWith('http') ? path : `https://api.hubapi.com${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    // 3. Reactive 401 Self-Healing: Evict stale Redis token, rotate via mutex, and replay once
    if (response.status === 401 && !isRetryAfter401) {
      return this.request<T>({
        ...params,
        isRetryAfter401: true,
      });
    }

    const telemetry = parseHubSpotRateLimitHeaders(response.headers);

    // 4. Reactive 429 Handling
    if (response.status === 429) {
      await this.redis.set(cooldownKey, telemetry.kind, 'PX', telemetry.retryAfterMs);
      throw new HubSpotRateLimitError(tenantId, telemetry.retryAfterMs, telemetry);
    }

    // 5. Proactive Rate-Limit Backpressure
    if (
      telemetry.remainingBurst !== null &&
      telemetry.remainingBurst <= this.PROACTIVE_RESERVE_THRESHOLD
    ) {
      await this.redis.set(cooldownKey, 'PROACTIVE_RESERVE', 'PX', telemetry.intervalMs);
    }

    const data = (await response.json().catch(() => ({}))) as T;
    return { status: response.status, data, headers: response.headers };
  }
}