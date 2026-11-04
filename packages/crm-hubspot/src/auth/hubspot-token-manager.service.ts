import Redis from 'ioredis';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { EnvelopeCryptoService } from '../crypto/envelope-crypto.service';

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
  expires_in: number;
  token_type: string;
}

export class HubSpotTokenManagerService {
  private readonly EXPIRY_SAFETY_BUFFER_MS = 120 * 1000;
  private readonly LOCK_TTL_MS = 15_000;
  private readonly FOLLOWER_MAX_WAIT_MS = 12_000;

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
    private readonly crypto: EnvelopeCryptoService,
  ) {}

  private getTokenCacheKey(tenantId: string): string {
    return `vexel:hs:token:${tenantId}`;
  }

  private getMutexKey(tenantId: string): string {
    return `vexel:hs:oauth-lock:${tenantId}`;
  }

  /**
   * Called during initial OAuth callback to encrypt and store both tokens at rest
   */
  async sealAndStoreInitialTokens(params: {
    tenantId: string;
    portalId: string;
    rawAccessToken: string;
    rawRefreshToken: string;
    expiresInSeconds: number;
  }): Promise<void> {
    const { tenantId, portalId, rawAccessToken, rawRefreshToken, expiresInSeconds } = params;

    const sealedAccess = this.crypto.encrypt(
      rawAccessToken,
      tenantId,
      'hubspot_access_token',
    );
    const sealedRefresh = this.crypto.encrypt(
      rawRefreshToken,
      tenantId,
      'hubspot_refresh_token',
    );

    const expiresInMs = expiresInSeconds * 1000;
    const expiresAt = new Date(Date.now() + expiresInMs);

    await this.prisma.tenant.update({
      where: { id: tenantId },
      data: {
        hubspotPortalId: portalId,
        hubspotAccessToken: sealedAccess,
        hubspotRefreshToken: sealedRefresh,
        hubspotTokenExpires: expiresAt,
      },
    });

    const redisCacheTtlMs = Math.max(60_000, expiresInMs - this.EXPIRY_SAFETY_BUFFER_MS);
    await this.redis.set(
      this.getTokenCacheKey(tenantId),
      sealedAccess,
      'PX',
      redisCacheTtlMs,
    );
  }

  /**
   * Returns the decrypted HubSpot access_token in memory only.
   * Both Redis and PostgreSQL store strictly the AES-256-GCM envelope.
   */
  async getValidAccessToken(tenantId: string, forceRefresh = false): Promise<string> {
    const cacheKey = this.getTokenCacheKey(tenantId);

    // 1. Fast-Path: Read sealed envelope from Redis & decrypt in-memory (~0.08ms)
    if (!forceRefresh) {
      const cachedEnvelope = await this.redis.get(cacheKey);
      if (cachedEnvelope) {
        const { plaintext } = this.crypto.decrypt(
          cachedEnvelope,
          tenantId,
          'hubspot_access_token',
        );
        return plaintext;
      }
    } else {
      await this.redis.del(cacheKey);
    }

    // 2. Fallback: Check PostgreSQL if Redis cache missed but DB token hasn't expired
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
          const { plaintext, needsKeyRotation } = this.crypto.decrypt(
            tenant.hubspotAccessToken,
            tenantId,
            'hubspot_access_token',
          );

          // Re-wrap with newer KEK version if master key was rotated
          const envelopeToCache = needsKeyRotation
            ? this.crypto.encrypt(plaintext, tenantId, 'hubspot_access_token')
            : tenant.hubspotAccessToken;

          const cacheTtlMs = remainingMs - this.EXPIRY_SAFETY_BUFFER_MS;
          await this.redis.set(cacheKey, envelopeToCache, 'PX', cacheTtlMs);
          return plaintext;
        }
      }
    }

    // 3. Acquire Single-Flight Redis Mutex for OAuth rotation
    const mutexKey = this.getMutexKey(tenantId);
    const lockToken = randomUUID();
    const acquired = await this.redis.set(mutexKey, lockToken, 'PX', this.LOCK_TTL_MS, 'NX');

    if (acquired === 'OK') {
      return this.executeLeaderRefresh(tenantId, mutexKey, lockToken);
    }

    return this.waitForLeaderRefresh(tenantId);
  }

  private async executeLeaderRefresh(
    tenantId: string,
    mutexKey: string,
    lockToken: string,
  ): Promise<string> {
    const cacheKey = this.getTokenCacheKey(tenantId);

    try {
      const alreadyRefreshedEnvelope = await this.redis.get(cacheKey);
      if (alreadyRefreshedEnvelope) {
        return this.crypto.decrypt(
          alreadyRefreshedEnvelope,
          tenantId,
          'hubspot_access_token',
        ).plaintext;
      }

      const tenant = await this.prisma.tenant.findUniqueOrThrow({
        where: { id: tenantId },
        select: { hubspotRefreshToken: true },
      });

      if (!tenant.hubspotRefreshToken) {
        throw new HubSpotOAuthRevokedError(tenantId, 'Missing hubspotRefreshToken in database');
      }

      // 1. Decrypt the stored refresh_token in memory using tenant-bound AAD
      const { plaintext: rawRefreshToken } = this.crypto.decrypt(
        tenant.hubspotRefreshToken,
        tenantId,
        'hubspot_refresh_token',
      );

      // 2. Exchange with HubSpot OAuth v1 endpoint
      const formData = new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: process.env.HUBSPOT_CLIENT_ID!,
        client_secret: process.env.HUBSPOT_CLIENT_SECRET!,
        refresh_token: rawRefreshToken,
      });

      const response = await fetch('https://api.hubapi.com/oauth/v1/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
      });

      if (!response.ok) {
        const errBody = (await response.json().catch(() => ({}))) as { message?: string; status?: string };
        const status = response.status;

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

      // 3. Seal both new tokens with fresh random 256-bit DEKs & active KEK version
      const sealedAccessToken = this.crypto.encrypt(
        tokenData.access_token,
        tenantId,
        'hubspot_access_token',
      );
      const sealedRefreshToken = this.crypto.encrypt(
        tokenData.refresh_token,
        tenantId,
        'hubspot_refresh_token',
      );

      // 4. Persist strictly the encrypted envelopes to PostgreSQL
      await this.prisma.tenant.update({
        where: { id: tenantId },
        data: {
          hubspotAccessToken: sealedAccessToken,
          hubspotRefreshToken: sealedRefreshToken,
          hubspotTokenExpires: expiresAt,
        },
      });

      // 5. Store strictly the encrypted envelope in Redis
      const redisCacheTtlMs = Math.max(60_000, expiresInMs - this.EXPIRY_SAFETY_BUFFER_MS);
      await this.redis.set(cacheKey, sealedAccessToken, 'PX', redisCacheTtlMs);

      return tokenData.access_token;
    } finally {
      await this.redis.eval(this.releaseLockLua, 1, mutexKey, lockToken);
    }
  }

  private async waitForLeaderRefresh(tenantId: string): Promise<string> {
    const cacheKey = this.getTokenCacheKey(tenantId);
    const mutexKey = this.getMutexKey(tenantId);
    const deadline = Date.now() + this.FOLLOWER_MAX_WAIT_MS;

    while (Date.now() < deadline) {
      const sleepMs = Math.floor(120 + Math.random() * 100);
      await new Promise((resolve) => setTimeout(resolve, sleepMs));

      const freshEnvelope = await this.redis.get(cacheKey);
      if (freshEnvelope) {
        return this.crypto.decrypt(
          freshEnvelope,
          tenantId,
          'hubspot_access_token',
        ).plaintext;
      }

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