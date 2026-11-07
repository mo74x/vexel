import Redis from 'ioredis';
import { createHash, randomInt, timingSafeEqual } from 'crypto';
import { VexelPrismaClient } from '@vexel/database';
import { HubSpotHttpClient } from '../client/hubspot-http.client';

export interface RepLinkOtpChallenge {
  otpCode: string;
  email: string;
  fullName: string;
  hubspotOwnerId: string;
  expiresInSeconds: number;
}

export type RepLinkOtpVerificationResult =
  | {
      status: 'verified';
      fullName: string;
      hubspotOwnerId: string;
      email: string;
    }
  | {
      status: 'invalid_or_expired' | 'max_attempts_exceeded';
    };

interface PendingRepLinkOtpSession {
  tenantId: string;
  hubspotOwnerId: string;
  email: string;
  fullName: string;
  e164Phone: string;
  otpHash: string;
  attempts: number;
}

export interface ResolvedOwnerRoute {
  hubspotOwnerId: string | null;
  ownerName: string;
  ownerEmail: string | null;
  destinationWhatsappPhone: string;
  isFallbackRoute: boolean;
  fallbackReason?: string;
}

interface CachedOwnerRecord {
  hubspotOwnerId: string;
  email: string;
  fullName: string;
  whatsappPhone: string | null;
  isActive: boolean;
}

interface HubSpotOwnerApiResponse {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  archived?: boolean;
}

export class HubSpotOwnerResolverService {
  private readonly CACHE_TTL_SECONDS = 12 * 3600; // 12 hours
  private readonly OTP_TTL_SECONDS = 600; // 10 minutes
  private readonly MAX_OTP_ATTEMPTS = 5;

  constructor(
    private readonly prisma: VexelPrismaClient,
    private readonly redis: Redis,
    private readonly http: HubSpotHttpClient,
  ) {}

  private getHashKey(tenantId: string): string {
    return `vexel:owners:${tenantId}`;
  }

  private getLinkOtpKey(tenantId: string, e164Phone: string): string {
    return `vexel:rep-link-otp:${tenantId}:${e164Phone}`;
  }

  private hashOtp(otpCode: string): string {
    return createHash('sha256').update(otpCode.trim()).digest('hex');
  }

  /**
   * Resolves a HubSpot Owner ID to a verified WhatsApp destination number.
   * Falls back cleanly to tenant.fallbackApprovalPhone if deal is unowned or rep hasn't linked WhatsApp.
   */
  async resolveApprovalDestination(
    tenantId: string,
    hubspotOwnerId: string | null,
    tenantFallbackPhone: string,
  ): Promise<ResolvedOwnerRoute> {
    if (!hubspotOwnerId) {
      return {
        hubspotOwnerId: null,
        ownerName: 'Unassigned Deal',
        ownerEmail: null,
        destinationWhatsappPhone: tenantFallbackPhone,
        isFallbackRoute: true,
        fallbackReason: 'No hubspot_owner_id assigned on Deal or Contact',
      };
    }

    const hashKey = this.getHashKey(tenantId);

    // 1. Fast-Path: Check Redis Hash (~0.4ms)
    const cachedRaw = await this.redis.hget(hashKey, hubspotOwnerId);
    if (cachedRaw) {
      const cached = JSON.parse(cachedRaw) as CachedOwnerRecord;
      return this.buildRouteResponse(cached, tenantFallbackPhone);
    }

    // 2. Check PostgreSQL TenantRep table before calling HubSpot API
    let dbRep = await this.prisma.tenantRep.findUnique({
      where: {
        tenantId_hubspotOwnerId: { tenantId, hubspotOwnerId },
      },
    });

    // 3. Cache Miss in DB -> Fetch live from HubSpot Owners API (/crm/v3/owners/{ownerId})
    if (!dbRep) {
      dbRep = await this.fetchAndUpsertSingleOwner(tenantId, hubspotOwnerId);
    }

    if (!dbRep) {
      return {
        hubspotOwnerId,
        ownerName: `Unknown Owner (#${hubspotOwnerId})`,
        ownerEmail: null,
        destinationWhatsappPhone: tenantFallbackPhone,
        isFallbackRoute: true,
        fallbackReason: `Owner ID ${hubspotOwnerId} not found in HubSpot /crm/v3/owners`,
      };
    }

    const recordToCache: CachedOwnerRecord = {
      hubspotOwnerId: dbRep.hubspotOwnerId,
      email: dbRep.email,
      fullName: dbRep.fullName,
      whatsappPhone: dbRep.whatsappPhone,
      isActive: dbRep.isActive,
    };

    await this.redis.hset(hashKey, hubspotOwnerId, JSON.stringify(recordToCache));
    await this.redis.expire(hashKey, this.CACHE_TTL_SECONDS);

    return this.buildRouteResponse(recordToCache, tenantFallbackPhone);
  }

  /**
   * Calls GET /crm/v3/owners/{ownerId} and upserts into PostgreSQL TenantRep
   */
  private async fetchAndUpsertSingleOwner(tenantId: string, hubspotOwnerId: string) {
    const res = await this.http.request<HubSpotOwnerApiResponse>({
      tenantId,
      path: `/crm/v3/owners/${hubspotOwnerId}`,
      method: 'GET',
    });

    if (res.status === 404 || !res.data?.id) {
      return null;
    }

    if (res.status >= 400) {
      throw new Error(`HubSpot Owners API failed (${res.status}): ${JSON.stringify(res.data)}`);
    }

    const owner = res.data;
    const email = (owner.email ?? `owner-${owner.id}@unmapped.local`).toLowerCase().trim();
    const fullName =
      [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim() || email;

    return this.prisma.tenantRep.upsert({
      where: {
        tenantId_hubspotOwnerId: {
          tenantId,
          hubspotOwnerId: String(owner.id),
        },
      },
      update: {
        email,
        fullName,
        isActive: !owner.archived,
      },
      create: {
        tenantId,
        hubspotOwnerId: String(owner.id),
        email,
        fullName,
        isActive: !owner.archived,
      },
    });
  }

  /**
   * Bulk syncs all active HubSpot owners for a tenant and warms the Redis Hash cache
   */
  async syncAllOwnersFromHubSpot(tenantId: string): Promise<{ syncedCount: number }> {
    const res = await this.http.request<{ results: HubSpotOwnerApiResponse[] }>({
      tenantId,
      path: '/crm/v3/owners?limit=100&archived=false',
      method: 'GET',
    });

    if (res.status >= 400 || !Array.isArray(res.data?.results)) {
      throw new Error(`HubSpot bulk owners sync failed (${res.status})`);
    }

    const hashKey = this.getHashKey(tenantId);
    const pipeline = this.redis.pipeline();

    for (const owner of res.data.results) {
      const hubspotOwnerId = String(owner.id);
      const email = (owner.email ?? `owner-${hubspotOwnerId}@unmapped.local`).toLowerCase().trim();
      const fullName =
        [owner.firstName, owner.lastName].filter(Boolean).join(' ').trim() || email;

      const upserted = await this.prisma.tenantRep.upsert({
        where: {
          tenantId_hubspotOwnerId: { tenantId, hubspotOwnerId },
        },
        update: { email, fullName, isActive: !owner.archived },
        create: {
          tenantId,
          hubspotOwnerId,
          email,
          fullName,
          isActive: !owner.archived,
        },
      });

      const cachePayload: CachedOwnerRecord = {
        hubspotOwnerId,
        email: upserted.email,
        fullName: upserted.fullName,
        whatsappPhone: upserted.whatsappPhone,
        isActive: upserted.isActive,
      };

      pipeline.hset(hashKey, hubspotOwnerId, JSON.stringify(cachePayload));
    }

    pipeline.expire(hashKey, this.CACHE_TTL_SECONDS);
    await pipeline.exec();

    return { syncedCount: res.data.results.length };
  }

  /**
   * Zero-Touch Rep Self-Linking: When a rep texts "/link sara@company.com" on WhatsApp,
   * binds their senderPhone to their synced HubSpot Owner profile and updates Redis immediately.
   */
  async bindRepWhatsAppByEmail(
    tenantId: string,
    repEmailInput: string,
    rawSenderPhone: string,
  ): Promise<{ fullName: string; hubspotOwnerId: string } | null> {
    const normalizedEmail = repEmailInput.toLowerCase().trim();
    const e164Phone = `+${rawSenderPhone.replace(/\D/g, '')}`;

    // If owners haven't been synced yet, run a quick sync first
    const existingCount = await this.prisma.tenantRep.count({ where: { tenantId } });
    if (existingCount === 0) {
      await this.syncAllOwnersFromHubSpot(tenantId);
    }

    const rep = await this.prisma.tenantRep.findUnique({
      where: {
        tenantId_email: { tenantId, email: normalizedEmail },
      },
    });

    if (!rep) {
      return null;
    }

    const updated = await this.prisma.tenantRep.update({
      where: { id: rep.id },
      data: { whatsappPhone: e164Phone },
    });

    // Immediately update Redis Hash field so the very next approval card routes to this rep
    const cachePayload: CachedOwnerRecord = {
      hubspotOwnerId: updated.hubspotOwnerId,
      email: updated.email,
      fullName: updated.fullName,
      whatsappPhone: updated.whatsappPhone,
      isActive: updated.isActive,
    };

    await this.redis.hset(
      this.getHashKey(tenantId),
      updated.hubspotOwnerId,
      JSON.stringify(cachePayload),
    );

    return {
      fullName: updated.fullName,
      hubspotOwnerId: updated.hubspotOwnerId,
    };
  }

  /**
   * Step 1 of Two-Step Rep Self-Linking (/link <email>):
   * Verifies the corporate email exists in HubSpot Owners, generates a 6-digit OTP,
   * stores its SHA-256 hash in Redis for 10 minutes, and returns the challenge for email delivery.
   */
  async requestRepLinkOtp(
    tenantId: string,
    repEmailInput: string,
    rawSenderPhone: string,
  ): Promise<RepLinkOtpChallenge | null> {
    const normalizedEmail = repEmailInput.toLowerCase().trim();
    const e164Phone = `+${rawSenderPhone.replace(/\D/g, '')}`;

    const existingCount = await this.prisma.tenantRep.count({ where: { tenantId } });
    if (existingCount === 0) {
      await this.syncAllOwnersFromHubSpot(tenantId);
    }

    const rep = await this.prisma.tenantRep.findUnique({
      where: {
        tenantId_email: { tenantId, email: normalizedEmail },
      },
    });

    if (!rep || !rep.isActive) {
      return null;
    }

    const otpCode = randomInt(100_000, 1_000_000).toString();
    const session: PendingRepLinkOtpSession = {
      tenantId,
      hubspotOwnerId: rep.hubspotOwnerId,
      email: rep.email,
      fullName: rep.fullName,
      e164Phone,
      otpHash: this.hashOtp(otpCode),
      attempts: 0,
    };

    await this.redis.set(
      this.getLinkOtpKey(tenantId, e164Phone),
      JSON.stringify(session),
      'EX',
      this.OTP_TTL_SECONDS,
    );

    return {
      otpCode,
      email: rep.email,
      fullName: rep.fullName,
      hubspotOwnerId: rep.hubspotOwnerId,
      expiresInSeconds: this.OTP_TTL_SECONDS,
    };
  }

  /**
   * Step 2 of Two-Step Rep Self-Linking (/verify <6-digit-otp>):
   * Verifies the OTP in constant time with a 5-attempt brute-force ceiling before
   * binding the WhatsApp senderPhone to the HubSpot Owner record.
   */
  async verifyRepLinkOtp(
    tenantId: string,
    rawSenderPhone: string,
    otpInput: string,
  ): Promise<RepLinkOtpVerificationResult> {
    const e164Phone = `+${rawSenderPhone.replace(/\D/g, '')}`;
    const otpKey = this.getLinkOtpKey(tenantId, e164Phone);
    const rawSession = await this.redis.get(otpKey);

    if (!rawSession) {
      return { status: 'invalid_or_expired' };
    }

    const session = JSON.parse(rawSession) as PendingRepLinkOtpSession;
    if (session.attempts >= this.MAX_OTP_ATTEMPTS) {
      await this.redis.del(otpKey);
      return { status: 'max_attempts_exceeded' };
    }

    const candidateHash = this.hashOtp(otpInput);
    const expectedBuf = Buffer.from(session.otpHash, 'hex');
    const candidateBuf = Buffer.from(candidateHash, 'hex');

    const isMatch =
      expectedBuf.length === candidateBuf.length &&
      timingSafeEqual(expectedBuf, candidateBuf);

    if (!isMatch) {
      session.attempts += 1;
      if (session.attempts >= this.MAX_OTP_ATTEMPTS) {
        await this.redis.del(otpKey);
        return { status: 'max_attempts_exceeded' };
      }

      await this.redis.set(
        otpKey,
        JSON.stringify(session),
        'EX',
        this.OTP_TTL_SECONDS,
      );
      return { status: 'invalid_or_expired' };
    }

    await this.redis.del(otpKey);
    const bound = await this.bindRepWhatsAppByEmail(tenantId, session.email, e164Phone);
    if (!bound) {
      return { status: 'invalid_or_expired' };
    }

    return {
      status: 'verified',
      fullName: bound.fullName,
      hubspotOwnerId: bound.hubspotOwnerId,
      email: session.email,
    };
  }

  private buildRouteResponse(
    owner: CachedOwnerRecord,
    tenantFallbackPhone: string,
  ): ResolvedOwnerRoute {
    if (owner.whatsappPhone && owner.isActive) {
      return {
        hubspotOwnerId: owner.hubspotOwnerId,
        ownerName: owner.fullName,
        ownerEmail: owner.email,
        destinationWhatsappPhone: owner.whatsappPhone,
        isFallbackRoute: false,
      };
    }

    return {
      hubspotOwnerId: owner.hubspotOwnerId,
      ownerName: owner.fullName,
      ownerEmail: owner.email,
      destinationWhatsappPhone: tenantFallbackPhone,
      isFallbackRoute: true,
      fallbackReason: `Rep ${owner.fullName} (${owner.email}) has not linked their WhatsApp number yet`,
    };
  }
}