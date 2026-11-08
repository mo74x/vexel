import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { MembershipRole } from '@prisma/client';
import { PrismaService, TenantContext } from '@vexel/database';
import { VexelLockService } from '../redis/vexel-lock.service';
import * as emailSenderInterface from './email-sender.interface';

export const SESSION_COOKIE_NAME = 'vexel_session';

export interface StoredMagicLinkRecord {
  userId: string;
  email: string;
  createdAt: string;
}

export interface StoredAppSessionRecord {
  userId: string;
  activeTenantId: string | null;
  createdAt: string;
}

export interface AuthenticatedTenantSummary {
  id: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
  autoSyncThreshold: number;
  manualMinutesPerUpdate: number;
}

export interface AuthenticatedMembershipSummary {
  id: string;
  tenantId: string;
  role: MembershipRole;
  tenant: AuthenticatedTenantSummary;
}

export interface AuthenticatedUserProfile {
  id: string;
  email: string;
  name: string;
  locale: string;
  isOperator: boolean;
  createdAt: Date;
}

export interface ResolvedAuthContext {
  user: AuthenticatedUserProfile;
  memberships: AuthenticatedMembershipSummary[];
  activeTenant: AuthenticatedTenantSummary | null;
  activeRole: MembershipRole | null;
  sessionToken: string;
}

@Injectable()
export class MagicLinkAuthService {
  public readonly MAGIC_LINK_TTL_SECONDS = 15 * 60; // 15 minutes
  public readonly SESSION_TTL_SECONDS = 7 * 24 * 3600; // 7 days
  public readonly RATE_LIMIT_WINDOW_SECONDS = 15 * 60; // 15 minutes
  public readonly MAX_REQUESTS_PER_EMAIL = 3;
  public readonly MAX_REQUESTS_PER_IP = 10;

  private readonly emailSender: emailSenderInterface.EmailSender;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: VexelLockService,
    @Optional() @Inject(emailSenderInterface.EMAIL_SENDER_TOKEN) emailSender?: emailSenderInterface.EmailSender,
  ) {
    this.emailSender = emailSender ?? emailSenderInterface.createDefaultEmailSender();
  }

  public hashToken(rawToken: string): string {
    return createHash('sha256').update(rawToken).digest('hex');
  }

  private getMagicLinkKey(tokenHash: string): string {
    return `vexel:magic:${tokenHash}`;
  }

  private getSessionKey(sessionHash: string): string {
    return `vexel:sess:${sessionHash}`;
  }

  private getEmailRateLimitKey(normalizedEmail: string): string {
    const emailHash = this.hashToken(normalizedEmail);
    return `vexel:rl:magic:email:${emailHash}`;
  }

  private getIpRateLimitKey(clientIp: string): string {
    const ipHash = this.hashToken(clientIp.trim() || 'unknown');
    return `vexel:rl:magic:ip:${ipHash}`;
  }

  /**
   * Generates a single-use 15-minute magic-link token, stores its SHA-256 hash in Redis,
   * and dispatches the link via EmailSender if the email belongs to an existing User.
   */
  async requestMagicLink(params: {
    email: string;
    clientIp?: string;
    appBaseUrl?: string;
  }): Promise<{ status: 'magic_link_sent' }> {
    const normalizedEmail = (params.email ?? '').trim().toLowerCase();
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      throw new BadRequestException('A valid email address is required');
    }

    const clientIp = (params.clientIp ?? '127.0.0.1').trim() || '127.0.0.1';

    // 1. Enforce per-IP and per-email rate limits in Redis
    await this.enforceRateLimits(normalizedEmail, clientIp);

    // 2. Look up existing User (global table). Return uniform response if unknown to prevent enumeration.
    const user = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return { status: 'magic_link_sent' };
    }

    // 3. Generate cryptographically random single-use token and store ONLY its SHA-256 hash in Redis
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(rawToken);
    const record: StoredMagicLinkRecord = {
      userId: user.id,
      email: user.email,
      createdAt: new Date().toISOString(),
    };

    await this.lockService.redis.set(
      this.getMagicLinkKey(tokenHash),
      JSON.stringify(record),
      'EX',
      this.MAGIC_LINK_TTL_SECONDS,
    );

    const baseUrl = (
      params.appBaseUrl ||
      process.env.VEXEL_APP_URL ||
      'http://localhost:3000'
    ).replace(/\/+$/, '');
    const magicLinkUrl = `${baseUrl}/auth/verify?token=${encodeURIComponent(rawToken)}`;

    await this.emailSender.sendMagicLink({
      to: user.email,
      name: user.name,
      magicLinkUrl,
      token: rawToken,
      expiresInMinutes: this.MAGIC_LINK_TTL_SECONDS / 60,
      locale: user.locale || 'en',
    });

    return { status: 'magic_link_sent' };
  }

  /**
   * Atomically consumes a single-use magic-link token via GETDEL, establishes an httpOnly session,
   * and returns the user's profile, memberships, and active tenant.
   */
  async verifyMagicLink(params: {
    token: string;
    preferredTenantId?: string;
  }): Promise<ResolvedAuthContext & { cookieHeader: string }> {
    const rawToken = (params.token ?? '').trim();
    if (!rawToken) {
      throw new BadRequestException('Magic link token is required');
    }

    const tokenHash = this.hashToken(rawToken);
    const rawRecord = await this.lockService.redis.getdel(this.getMagicLinkKey(tokenHash));
    if (!rawRecord) {
      throw new UnauthorizedException('Invalid or expired magic link token');
    }

    const magicRecord = JSON.parse(rawRecord) as StoredMagicLinkRecord;
    const { user, memberships } = await this.loadUserAndMemberships(magicRecord.userId);

    let selectedMembership = memberships[0] ?? null;
    if (params.preferredTenantId) {
      const matched = memberships.find((m) => m.tenantId === params.preferredTenantId);
      if (!matched) {
        throw new ForbiddenException(
          `User does not belong to tenant "${params.preferredTenantId}"`,
        );
      }
      selectedMembership = matched;
    }

    const activeTenant = selectedMembership?.tenant ?? null;
    const activeRole = selectedMembership?.role ?? null;

    // Issue opaque session token and store only its SHA-256 hash in Redis
    const sessionToken = randomBytes(32).toString('base64url');
    const sessionHash = this.hashToken(sessionToken);
    const sessionRecord: StoredAppSessionRecord = {
      userId: user.id,
      activeTenantId: activeTenant?.id ?? null,
      createdAt: new Date().toISOString(),
    };

    await this.lockService.redis.set(
      this.getSessionKey(sessionHash),
      JSON.stringify(sessionRecord),
      'EX',
      this.SESSION_TTL_SECONDS,
    );

    if (activeTenant && (this.prisma as any).auditLog?.create) {
      await TenantContext.run(activeTenant.id, async () => {
        await this.prisma.auditLog.create({
          data: {
            tenantId: activeTenant.id,
            actorUserId: user.id,
            action: 'auth.magic_link_verified',
            targetType: 'User',
            targetId: user.id,
            meta: {
              email: user.email,
              role: activeRole,
            },
          },
        });
      });
    }

    const cookieHeader = this.buildSessionCookieHeader(sessionToken, this.SESSION_TTL_SECONDS);

    return {
      user,
      memberships,
      activeTenant,
      activeRole,
      sessionToken,
      cookieHeader,
    };
  }

  /**
   * Resolves an active session token and optional x-vexel-tenant-id header into a verified
   * user + tenant + role context. Denies cross-tenant access if the user has no Membership in the target tenant.
   */
  async resolveSession(params: {
    sessionToken: string | undefined;
    requestedTenantId?: string;
    requireTenant?: boolean;
  }): Promise<ResolvedAuthContext> {
    const rawSessionToken = (params.sessionToken ?? '').trim();
    if (!rawSessionToken) {
      throw new UnauthorizedException('Missing authentication session');
    }

    const sessionHash = this.hashToken(rawSessionToken);
    const sessionKey = this.getSessionKey(sessionHash);
    const rawSession = await this.lockService.redis.get(sessionKey);
    if (!rawSession) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    const sessionRecord = JSON.parse(rawSession) as StoredAppSessionRecord;
    const { user, memberships } = await this.loadUserAndMemberships(sessionRecord.userId);

    const targetTenantId =
      params.requestedTenantId?.trim() ||
      sessionRecord.activeTenantId ||
      memberships[0]?.tenantId ||
      null;

    let activeTenant: AuthenticatedTenantSummary | null = null;
    let activeRole: MembershipRole | null = null;

    if (targetTenantId) {
      const membership = memberships.find((m) => m.tenantId === targetTenantId);
      if (!membership) {
        throw new ForbiddenException(
          `[CROSS_TENANT_DENIED] User "${user.email}" is not a member of tenant "${targetTenantId}"`,
        );
      }

      activeTenant = membership.tenant;
      activeRole = membership.role;

      // Persist tenant switch in Redis session if requested via header
      if (sessionRecord.activeTenantId !== targetTenantId) {
        const updatedSession: StoredAppSessionRecord = {
          ...sessionRecord,
          activeTenantId: targetTenantId,
        };
        await this.lockService.redis.set(
          sessionKey,
          JSON.stringify(updatedSession),
          'EX',
          this.SESSION_TTL_SECONDS,
        );
      }
    } else if (params.requireTenant !== false && !user.isOperator) {
      throw new ForbiddenException('User has no active tenant membership');
    }

    return {
      user,
      memberships,
      activeTenant,
      activeRole,
      sessionToken: rawSessionToken,
    };
  }

  async revokeSession(sessionToken: string | undefined): Promise<{ cookieHeader: string }> {
    const raw = (sessionToken ?? '').trim();
    if (raw) {
      const sessionHash = this.hashToken(raw);
      await this.lockService.redis.del(this.getSessionKey(sessionHash));
    }
    return {
      cookieHeader: this.buildSessionCookieHeader('', 0),
    };
  }

  public buildSessionCookieHeader(sessionToken: string, maxAgeSeconds: number): string {
    const isProd = process.env.NODE_ENV === 'production';
    const parts = [
      `${SESSION_COOKIE_NAME}=${sessionToken}`,
      'HttpOnly',
      'Path=/',
      `Max-Age=${maxAgeSeconds}`,
      'SameSite=Lax',
    ];
    if (isProd) {
      parts.push('Secure');
    }
    return parts.join('; ');
  }

  private async enforceRateLimits(normalizedEmail: string, clientIp: string): Promise<void> {
    const emailKey = this.getEmailRateLimitKey(normalizedEmail);
    const ipKey = this.getIpRateLimitKey(clientIp);

    const ipCount = await this.incrementWindowCounter(ipKey, this.RATE_LIMIT_WINDOW_SECONDS);
    if (ipCount > this.MAX_REQUESTS_PER_IP) {
      throw new HttpException(
        'Too many magic link requests from this IP. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const emailCount = await this.incrementWindowCounter(
      emailKey,
      this.RATE_LIMIT_WINDOW_SECONDS,
    );
    if (emailCount > this.MAX_REQUESTS_PER_EMAIL) {
      throw new HttpException(
        'Too many magic link requests for this email. Please try again in 15 minutes.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async incrementWindowCounter(key: string, ttlSeconds: number): Promise<number> {
    const count = await this.lockService.redis.incr(key);
    if (count === 1) {
      await this.lockService.redis.expire(key, ttlSeconds);
    }
    return count;
  }

  private async loadUserAndMemberships(userId: string): Promise<{
    user: AuthenticatedUserProfile;
    memberships: AuthenticatedMembershipSummary[];
  }> {
    return TenantContext.runAsSystem(async () => {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
      });

      if (!user) {
        throw new UnauthorizedException('User account no longer exists');
      }

      const rawMemberships = await this.prisma.membership.findMany({
        where: { userId: user.id },
        include: {
          tenant: {
            select: {
              id: true,
              name: true,
              slug: true,
              locale: true,
              timezone: true,
              autoSyncThreshold: true,
              manualMinutesPerUpdate: true,
            },
          },
        },
      });

      const memberships: AuthenticatedMembershipSummary[] = rawMemberships.map((m: any) => ({
        id: m.id,
        tenantId: m.tenantId,
        role: m.role,
        tenant: m.tenant,
      }));

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          locale: user.locale,
          isOperator: user.isOperator,
          createdAt: user.createdAt,
        },
        memberships,
      };
    });
  }
}
