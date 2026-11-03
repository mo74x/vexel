import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

export class HubSpotOAuthRevokedError extends Error {
  public readonly isPermanentOAuthError = true;

  constructor(public readonly tenantId: string, public readonly reason: string) {
    super(`HubSpot OAuth permanently revoked or invalid for tenant "${tenantId}": ${reason}`);
    this.name = 'HubSpotOAuthRevokedError';
  }
}

interface HubSpotTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // Typically 1800 seconds (30 minutes)
  token_type: string;
}

export class HubSpotTokenManagerService {
  private readonly EXPIRY_SAFETY_BUFFER_MS = 120 * 1000; // Refresh 2 mins before actual expiry
  private readonly LOCK_TTL_MS = 15_000;                 // Max 15s for OAuth HTTP round-trip
  private readonly FOLLOWER_MAX_WAIT_MS = 12_000;        // Max time follower waits for leader

  private readonly releaseLockLua = `
    if redis.call("GET", KEYS[1]) == ARGV[1] then
      return redis.call("DEL", KEYS[1])
    else
      return 0
    end
  `;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly redis: Redis,
  ) {}

  private getTokenCacheKey(tenantId: string): string {
    return `vexel:hs:token:${tenantId}`;
  }

  private getMutexKey(tenantId: string): string {
    return `vexel:hs:oauth-lock:${tenantId}`;
  }

  /**
   * Returns a valid HubSpot access_token for the tenant.
   * Uses Redis fast-path cache first, falling back to a distributed Leader/Follower mutex refresh.
   */
  async getValidAccessToken(tenantId: string, forceRefresh = false): Promise<string> {
    const cacheKey = this.getTokenCacheKey(tenantId);

    // 1. Fast-Path: Check Redis cache unless caller explicitly forced a refresh (e.g., after HTTP 401)
    if (!forceRefresh) {
      const cachedToken = await this.redis.get(cacheKey);
      if (cachedToken) {
        return cachedToken;
      }
    } else {
      await this.redis.del(cacheKey);
    }

    // 2. Check PostgreSQL in case Redis was flushed but DB token is still valid
    if (!forceRefresh) {
      const tenant = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: {
          hubspotAccessToken: true,
          hubspotTokenExpires: true,
        },
      });

      if (tenant.hubspotAccessToken && tenant.hubspotTokenExpires) {
        const remainingMs = tenant.hubspotTokenExpires.getTime() - Date.now();
        if (remainingMs > this.EXPIRY_SAFETY_BUFFER_MS) {
          const cacheTtlMs = remainingMs - this.EXPIRY_SAFETY_BUFFER_MS;
          await this.redis.set(cacheKey, tenant.hubspotAccessToken, 'PX', cacheTtlMs);
          return tenant.hubspotAccessToken;
        }
      }
    }

    // 3. Token is expired or force-evicted -> Attempt to acquire Single-Flight Redis Mutex
    const mutexKey = this.getMutexKey(tenantId);
    const lockToken = randomUUID();
    const acquired = await this.redis.set(mutexKey, lockToken, 'PX', this.LOCK_TTL_MS, 'NX');

    if (acquired === 'OK') {
      // LEADER PATH: We own the lock and perform the single OAuth rotation
      return this.executeLeaderRefresh(tenantId, mutexKey, lockToken);
    }

    // FOLLOWER PATH: Another worker is actively refreshing this tenant's token
    return this.waitForLeaderRefresh(tenantId);
  }

  private async executeLeaderRefresh(
    tenantId: string,
    mutexKey: string,
    lockToken: string,
  ): Promise<string> {
    const cacheKey = this.getTokenCacheKey(tenantId);

    try {
      // Double-check Redis cache in case a previous leader finished 1ms before we acquired the lock
      const alreadyRefreshed = await this.redis.get(cacheKey);
      if (alreadyRefreshed) {
        return alreadyRefreshed;
      }

      const tenant = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { hubspotRefreshToken: true },
      });

      if (!tenant.hubspotRefreshToken) {
        throw new HubSpotOAuthRevokedError(tenantId, 'Missing hubspotRefreshToken in database');
      }

      // Call HubSpot OAuth v1 Token Endpoint
      const formData = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.HUBSPOT_CLIENT_ID!,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
        refresh_token: tenant.hubspotRefreshToken,
      });

      const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { message?: string; status?: string };
        const status = response.status;

        // 400/401/403 on /oauth/v1/token means refresh token was revoked or app uninstalled
        if (status === 400 || status === 401 || status === 403) {
          throw new HubSpotOAuthRevokedError(
            tenantId,
            errBody?.message || errBody?.status || `HTTP ${status}`,
          );
        }

        throw new Error(`Transient HubSpot OAuth error (${status}): ${JSON.stringify(errBody)}`);
      }

      const tokenData = (await response.json()) as HubSpotTokenResponse;
      const expiresInMs = tokenData.expires_in * 1000;
      const expiresAt = new Date(Date.now() + expiresInMs);

      // 1. Persist rotated access_token AND new refresh_token atomically in PostgreSQL
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          hubspotAccessToken: tokenData.access_token,
          hubspotRefreshToken: tokenData.refresh_token,
          hubspotTokenExpires: expiresAt,
        },
      });

      // 2. Populate Redis Fast-Path Cache (with 2-minute safety buffer subtracted)
      const redisCacheTtlMs = Math.max(60_000, expiresInMs - this.EXPIRY_SAFETY_BUFFER_MS);
      await this.redis.set(cacheKey, tokenData.access_token, 'PX', redisCacheTtlMs);

      return tokenData.access_token;
    } finally {
      // 3. Always release the mutex using Compare-And-Delete Lua script
      await this.redis.eval(this.releaseLockLua, 1, mutexKey, lockToken);
    }
  }

  /**
   * Follower workers poll the Redis cache key with jitter until the Leader writes the new token
   */
  private async waitForLeaderRefresh(tenantId: string): Promise<string> {
    const cacheKey = this.getTokenCacheKey(tenantId);
    const mutexKey = this.getMutexKey(tenantId);
    const deadline = Date.now() + this.FOLLOWER_MAX_WAIT_MS;

    while (Date.now() < deadline) {
      // Sleep 120ms - 220ms with random jitter
      const sleepMs = Math.floor(120 + Math.random() * 100);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));

      const freshToken = await this.redis.get(cacheKey);
      if (freshToken) {
        return freshToken;
      }

      // If the leader released the lock without populating the cache (e.g., leader crashed),
      // break early and recursively try to become the new leader.
      const lockStillHeld = await this.redis.exists(mutexKey);
      if (lockStillHeld === 0) {
        return this.getValidAccessToken(tenantId, false);
      }
    }

    throw new Error(
      `Timed out waiting ${this.FOLLOWER_MAX_WAIT_MS}ms for HubSpot OAuth leader refresh on tenant "${tenantId}"`,
    );
  }
}