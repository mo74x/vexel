import { MembershipRole } from '@prisma/client';
import { TenantContext } from '@vexel/database';
import { AppAuthController } from '../app-auth.controller';
import { ConsoleEmailSender } from '../email-sender.interface';
import { MagicLinkAuthService } from '../magic-link-auth.service';
import { AppSessionGuard } from '../guards/app-session.guard';
import { OperatorGuard } from '../guards/operator.guard';
import { OperatorOnly, Roles } from '../decorators/roles.decorator';

function createInMemoryRedis() {
  const kv = new Map<string, { value: string; ttl: number }>();
  const counters = new Map<string, number>();

  return {
    kv,
    counters,
    async set(key: string, value: string, _mode?: string, ttl?: number) {
      kv.set(key, { value, ttl: ttl ?? 0 });
      return 'OK';
    },
    async get(key: string) {
      return kv.get(key)?.value ?? null;
    },
    async getdel(key: string) {
      const entry = kv.get(key);
      if (!entry) return null;
      kv.delete(key);
      return entry.value;
    },
    async del(...keys: string[]) {
      let deleted = 0;
      for (const k of keys) {
        if (kv.delete(k)) deleted++;
      }
      return deleted;
    },
    async incr(key: string) {
      const next = (counters.get(key) ?? 0) + 1;
      counters.set(key, next);
      return next;
    },
    async expire(_key: string, _ttl: number) {
      return 1;
    },
  };
}

describe('Passwordless Magic-Link Auth, Session Guard, Role Enforcement & Cross-Tenant Denial', () => {
  let redis: ReturnType<typeof createInMemoryRedis>;
  let emailSender: ConsoleEmailSender;
  let auditLogs: any[];
  let mockPrisma: any;
  let authService: MagicLinkAuthService;
  let controller: AppAuthController;
  let sessionGuard: AppSessionGuard;
  let operatorGuard: OperatorGuard;

  const tenantAlpha = {
    id: 'tenant_alpha',
    name: 'Alpha Corp',
    slug: 'alpha-corp',
    locale: 'en',
    timezone: 'Africa/Cairo',
    autoSyncThreshold: 85,
    manualMinutesPerUpdate: 5,
  };

  const tenantGamma = {
    id: 'tenant_gamma',
    name: 'Gamma Holdings',
    slug: 'gamma-holdings',
    locale: 'ar',
    timezone: 'Africa/Cairo',
    autoSyncThreshold: 90,
    manualMinutesPerUpdate: 7,
  };

  const users: Record<string, any> = {
    user_admin: {
      id: 'user_admin',
      email: 'nour@alpha.io',
      name: 'Nour El-Din',
      locale: 'en',
      isOperator: false,
      createdAt: new Date('2026-11-01T10:00:00Z'),
    },
    user_support: {
      id: 'user_support',
      email: 'support@alpha.io',
      name: 'Layla Support',
      locale: 'en',
      isOperator: false,
      createdAt: new Date('2026-11-02T10:00:00Z'),
    },
    user_operator: {
      id: 'user_operator',
      email: 'ops@vexel.io',
      name: 'Tariq Operator',
      locale: 'en',
      isOperator: true,
      createdAt: new Date('2026-11-01T00:00:00Z'),
    },
  };

  const memberships: any[] = [
    {
      id: 'mem_alpha_admin',
      userId: 'user_admin',
      tenantId: 'tenant_alpha',
      role: MembershipRole.ADMIN,
      tenant: tenantAlpha,
    },
    {
      id: 'mem_gamma_support',
      userId: 'user_admin',
      tenantId: 'tenant_gamma',
      role: MembershipRole.SUPPORT,
      tenant: tenantGamma,
    },
    {
      id: 'mem_alpha_support',
      userId: 'user_support',
      tenantId: 'tenant_alpha',
      role: MembershipRole.SUPPORT,
      tenant: tenantAlpha,
    },
  ];

  beforeEach(() => {
    redis = createInMemoryRedis();
    emailSender = new ConsoleEmailSender();
    auditLogs = [];

    mockPrisma = {
      user: {
        findUnique: async ({ where }: any) => {
          if (where.id) return users[where.id] ?? null;
          if (where.email) {
            return Object.values(users).find((u) => u.email === where.email) ?? null;
          }
          return null;
        },
      },
      membership: {
        findMany: async ({ where }: any) =>
          memberships.filter((m) => m.userId === where.userId),
      },
      auditLog: {
        create: async ({ data }: any) => {
          auditLogs.push(data);
          return { id: `aud_${auditLogs.length}`, ...data };
        },
      },
    };

    const mockLockService: any = { redis };
    authService = new MagicLinkAuthService(mockPrisma, mockLockService, emailSender);
    controller = new AppAuthController(authService);
    sessionGuard = new AppSessionGuard(authService);
    operatorGuard = new OperatorGuard(authService);
  });

  it('completes the magic-link lifecycle: hashes 15m token, enforces single-use GETDEL, sets httpOnly cookie, and serves GET /v1/app/me', async () => {
    // 1. Unknown email returns uniform magic_link_sent without sending email or storing token
    const unknownRes = await controller.requestMagicLink(
      { email: 'nobody@unknown.io' },
      '203.0.113.10',
    );
    expect(unknownRes).toEqual({ status: 'magic_link_sent' });
    expect(emailSender.sentEmails.length).toBe(0);
    expect(redis.kv.size).toBe(0);

    // 2. Registered user receives magic link; only SHA-256 hash is stored in Redis with 900s (15m) TTL
    const knownRes = await controller.requestMagicLink(
      { email: '  Nour@Alpha.io ', appBaseUrl: 'https://app.vexel.io' },
      '203.0.113.10',
    );
    expect(knownRes).toEqual({ status: 'magic_link_sent' });
    expect(emailSender.sentEmails.length).toBe(1);

    const sent = emailSender.sentEmails[0];
    expect(sent.to).toBe('nour@alpha.io');
    expect(sent.expiresInMinutes).toBe(15);
    expect(sent.magicLinkUrl).toContain('https://app.vexel.io/auth/verify?token=');

    const rawToken = sent.token;
    const expectedHash = authService.hashToken(rawToken);
    expect(redis.kv.has(`vexel:magic:${rawToken}`)).toBe(false);
    expect(redis.kv.has(`vexel:magic:${expectedHash}`)).toBe(true);
    expect(redis.kv.get(`vexel:magic:${expectedHash}`)?.ttl).toBe(900);

    // 3. Verify magic link sets HttpOnly session cookie, writes AuditLog, and returns user + memberships + activeTenant
    const headersSet: Record<string, string> = {};
    const verifyRes = await controller.verifyMagicLink(
      { token: rawToken },
      {
        setHeader: (name: string, value: string) => {
          headersSet[name] = value;
        },
      },
    );

    expect(verifyRes.user.email).toBe('nour@alpha.io');
    expect(verifyRes.memberships.length).toBe(2);
    expect(verifyRes.activeTenant?.id).toBe('tenant_alpha');
    expect(verifyRes.activeRole).toBe(MembershipRole.ADMIN);
    expect(headersSet['Set-Cookie']).toContain('vexel_session=');
    expect(headersSet['Set-Cookie']).toContain('HttpOnly');
    expect(headersSet['Set-Cookie']).toContain('SameSite=Lax');
    expect(auditLogs.length).toBe(1);
    expect(auditLogs[0].action).toBe('auth.magic_link_verified');
    expect(auditLogs[0].tenantId).toBe('tenant_alpha');

    // 4. Token is strictly single-use: second verify attempt with same token fails
    await expect(controller.verifyMagicLink({ token: rawToken })).rejects.toThrow(
      /Invalid or expired magic link token/,
    );

    // 5. GET /v1/app/me resolves session from Cookie header
    const cookiePair = headersSet['Set-Cookie'].split(';')[0];
    const req: any = {
      headers: {
        cookie: cookiePair,
      },
    };
    const mockContext: any = {
      switchToHttp: () => ({ getRequest: () => req }),
      getHandler: () => controller.getMe,
      getClass: () => AppAuthController,
    };

    const allowed = await sessionGuard.canActivate(mockContext);
    expect(allowed).toBe(true);
    expect(TenantContext.getStore()?.tenantId).toBe('tenant_alpha');

    const meRes = await controller.getMe(req);
    expect(meRes.user.id).toBe('user_admin');
    expect(meRes.activeTenant?.slug).toBe('alpha-corp');
    expect(meRes.activeRole).toBe(MembershipRole.ADMIN);

    // 6. Logout revokes session in Redis
    await controller.logout(req);
    await expect(sessionGuard.canActivate(mockContext)).rejects.toThrow(
      /Invalid or expired session/,
    );
  });

  it('enforces per-email and per-IP rate limits on POST /v1/app/auth/magic-link', async () => {
    // 3 requests allowed for the same email from the same IP
    for (let i = 0; i < 3; i++) {
      await controller.requestMagicLink({ email: 'nour@alpha.io' }, '198.51.100.5');
    }

    // 4th request for the same email is rejected with 429
    await expect(
      controller.requestMagicLink({ email: 'nour@alpha.io' }, '198.51.100.5'),
    ).rejects.toThrow(/Too many magic link requests for this email/);

    // Exceed IP rate limit (max 10 per IP across distinct emails)
    for (let i = 0; i < 10; i++) {
      await controller.requestMagicLink(
        { email: `person${i}@alpha.io` },
        '198.51.100.99',
      );
    }

    await expect(
      controller.requestMagicLink({ email: 'person99@alpha.io' }, '198.51.100.99'),
    ).rejects.toThrow(/Too many magic link requests from this IP/);
  });

  it('enforces @Roles decorator and OperatorGuard (@OperatorOnly)', async () => {
    class DummyAdminController {
      @Roles('ADMIN', 'MANAGER')
      updateSettings() {}

      @OperatorOnly()
      operatorDashboard() {}
    }
    const dummy = new DummyAdminController();

    // Sign in as Layla (SUPPORT role on tenant_alpha, isOperator: false)
    await controller.requestMagicLink({ email: 'support@alpha.io' }, '10.0.0.1');
    const supportToken = emailSender.sentEmails.at(-1)!.token;
    const supportVerified = await authService.verifyMagicLink({ token: supportToken });

    const supportReq: any = {
      headers: {
        cookie: supportVerified.cookieHeader.split(';')[0],
      },
    };

    const roleProtectedCtx: any = {
      switchToHttp: () => ({ getRequest: () => supportReq }),
      getHandler: () => dummy.updateSettings,
      getClass: () => DummyAdminController,
    };

    // SUPPORT user is blocked on @Roles('ADMIN', 'MANAGER')
    await expect(sessionGuard.canActivate(roleProtectedCtx)).rejects.toThrow(
      /Insufficient role "SUPPORT"/,
    );

    // Non-operator user is blocked by OperatorGuard and @OperatorOnly()
    const operatorCtx: any = {
      switchToHttp: () => ({ getRequest: () => ({ headers: supportReq.headers }) }),
      getHandler: () => dummy.operatorDashboard,
      getClass: () => DummyAdminController,
    };
    await expect(sessionGuard.canActivate(operatorCtx)).rejects.toThrow(
      /Operator privileges required/,
    );
    await expect(operatorGuard.canActivate(operatorCtx)).rejects.toThrow(
      /Operator privileges required/,
    );

    // Sign in as Tariq (isOperator: true) -> OperatorGuard succeeds and sets bypassRls = true when no tenant
    await controller.requestMagicLink({ email: 'ops@vexel.io' }, '10.0.0.2');
    const opToken = emailSender.sentEmails.at(-1)!.token;
    const opVerified = await authService.verifyMagicLink({ token: opToken });

    const opReq: any = {
      headers: {
        authorization: `Bearer ${opVerified.sessionToken}`,
      },
    };
    const opGuardCtx: any = {
      switchToHttp: () => ({ getRequest: () => opReq }),
      getHandler: () => dummy.operatorDashboard,
      getClass: () => DummyAdminController,
    };

    const opAllowed = await operatorGuard.canActivate(opGuardCtx);
    expect(opAllowed).toBe(true);
    expect(TenantContext.getStore()?.bypassRls).toBe(true);
  });

  it('denies cross-tenant access via x-vexel-tenant-id header and allows switching between authorized tenants with RLS context binding', async () => {
    await controller.requestMagicLink({ email: 'nour@alpha.io' }, '10.0.0.3');
    const token = emailSender.sentEmails.at(-1)!.token;
    const verified = await authService.verifyMagicLink({ token });

    // 1. Attempting to access tenant_beta (where Nour has no Membership) is denied with ForbiddenException
    const crossTenantReq: any = {
      headers: {
        cookie: verified.cookieHeader.split(';')[0],
        'x-vexel-tenant-id': 'tenant_beta_unauthorized',
      },
    };
    const crossTenantCtx: any = {
      switchToHttp: () => ({ getRequest: () => crossTenantReq }),
      getHandler: () => controller.getMe,
      getClass: () => AppAuthController,
    };

    await expect(sessionGuard.canActivate(crossTenantCtx)).rejects.toThrow(
      /CROSS_TENANT_DENIED/,
    );

    // 2. Switching to tenant_gamma (where Nour holds SUPPORT membership) succeeds and binds TenantContext to tenant_gamma
    const switchTenantReq: any = {
      headers: {
        cookie: verified.cookieHeader.split(';')[0],
        'x-vexel-tenant-id': 'tenant_gamma',
      },
    };
    const switchTenantCtx: any = {
      switchToHttp: () => ({ getRequest: () => switchTenantReq }),
      getHandler: () => controller.getMe,
      getClass: () => AppAuthController,
    };

    const allowed = await sessionGuard.canActivate(switchTenantCtx);
    expect(allowed).toBe(true);
    expect(switchTenantReq.activeTenant?.id).toBe('tenant_gamma');
    expect(switchTenantReq.activeRole).toBe(MembershipRole.SUPPORT);
    expect(TenantContext.getStore()?.tenantId).toBe('tenant_gamma');
    expect(TenantContext.getStore()?.bypassRls).toBe(false);
  });
});

