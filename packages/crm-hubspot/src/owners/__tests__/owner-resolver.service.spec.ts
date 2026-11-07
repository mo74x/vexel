import { HubSpotOwnerResolverService } from '../owner-resolver.service';

describe('HubSpotOwnerResolverService', () => {
  let hashStore: Map<string, string>;
  let kvStore: Map<string, string>;
  let dbReps: Map<string, any>;
  let mockRedis: any;
  let mockPrisma: any;
  let mockHttp: any;
  let service: HubSpotOwnerResolverService;

  beforeEach(() => {
    hashStore = new Map<string, string>();
    kvStore = new Map<string, string>();
    dbReps = new Map<string, any>();

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
      hget: async (_hash: string, field: string) => hashStore.get(field) ?? null,
      hset: async (_hash: string, field: string, val: string) => {
        hashStore.set(field, val);
        return 1;
      },
      expire: async () => 1,
      pipeline: () => {
        const ops: Array<() => void> = [];
        return {
          hset: (_hash: string, field: string, val: string) => {
            ops.push(() => hashStore.set(field, val));
            return this;
          },
          expire: () => this,
          exec: async () => {
            ops.forEach((fn) => fn());
            return [];
          },
        };
      },
    };

    mockPrisma = {
      tenantRep: {
        findUnique: async ({ where }: any) => {
          if (where.tenantId_hubspotOwnerId) {
            return dbReps.get(where.tenantId_hubspotOwnerId.hubspotOwnerId) ?? null;
          }
          if (where.tenantId_email) {
            for (const rep of dbReps.values()) {
              if (rep.email === where.tenantId_email.email) return rep;
            }
          }
          return null;
        },
        upsert: async ({ create, update, where }: any) => {
          const ownerId = where.tenantId_hubspotOwnerId.hubspotOwnerId;
          const existing = dbReps.get(ownerId);
          const merged = existing
            ? { ...existing, ...update }
            : { id: `rep_${ownerId}`, whatsappPhone: null, ...create };
          dbReps.set(ownerId, merged);
          return merged;
        },
        update: async ({ where, data }: any) => {
          for (const [k, v] of dbReps.entries()) {
            if (v.id === where.id) {
              const updated = { ...v, ...data };
              dbReps.set(k, updated);
              return updated;
            }
          }
          throw new Error('Rep not found');
        },
        count: async () => dbReps.size,
      },
    };

    mockHttp = {
      request: async ({ path }: { path: string }) => {
        if (path === '/crm/v3/owners/74829104') {
          return {
            status: 200,
            data: {
              id: '74829104',
              email: 'Sara.Kamel@Company.com',
              firstName: 'Sara',
              lastName: 'Kamel',
              archived: false,
            },
          };
        }
        if (path.startsWith('/crm/v3/owners?')) {
          return {
            status: 200,
            data: {
              results: [
                {
                  id: '74829104',
                  email: 'sara.kamel@company.com',
                  firstName: 'Sara',
                  lastName: 'Kamel',
                  archived: false,
                },
              ],
            },
          };
        }
        return { status: 404, data: {} };
      },
    };

    service = new HubSpotOwnerResolverService(mockPrisma, mockRedis, mockHttp);
  });

  it('returns fallback phone when no hubspotOwnerId is assigned on Deal or Contact', async () => {
    const route = await service.resolveApprovalDestination('tenant_1', null, '+201000000001');
    expect(route.isFallbackRoute).toBe(true);
    expect(route.destinationWhatsappPhone).toBe('+201000000001');
    expect(route.fallbackReason).toContain('No hubspot_owner_id assigned');
  });

  it('hydrates missing owner from HubSpot /crm/v3/owners, warns if WhatsApp is unlinked, and routes directly once linked via /link', async () => {
    // 1. Owner exists in HubSpot but hasn't linked personal WhatsApp yet -> routes to fallback
    const unlinkedRoute = await service.resolveApprovalDestination(
      'tenant_1',
      '74829104',
      '+201000000001',
    );
    expect(unlinkedRoute.isFallbackRoute).toBe(true);
    expect(unlinkedRoute.ownerName).toBe('Sara Kamel');
    expect(unlinkedRoute.destinationWhatsappPhone).toBe('+201000000001');

    // 2. Rep sends "/link sara.kamel@company.com" from their personal WhatsApp
    const linked = await service.bindRepWhatsAppByEmail(
      'tenant_1',
      '  SARA.KAMEL@company.com ',
      '201223344556',
    );
    expect(linked).toEqual({
      fullName: 'Sara Kamel',
      hubspotOwnerId: '74829104',
    });

    // 3. Subsequent resolution hits Redis Hash fast-path and routes to Sara's personal WhatsApp
    const directRoute = await service.resolveApprovalDestination(
      'tenant_1',
      '74829104',
      '+201000000001',
    );
    expect(directRoute.isFallbackRoute).toBe(false);
    expect(directRoute.destinationWhatsappPhone).toBe('+201223344556');
  });

  it('enforces two-step OTP verification (/link + /verify) and locks out after 5 wrong OTP attempts', async () => {
    const challenge = await service.requestRepLinkOtp(
      'tenant_1',
      'sara.kamel@company.com',
      '201223344556',
    );
    expect(challenge).not.toBeNull();
    expect(challenge?.otpCode).toMatch(/^\d{6}$/);
    expect(challenge?.email).toBe('sara.kamel@company.com');

    // Wrong OTP attempt 1 -> invalid_or_expired
    const badAttempt = await service.verifyRepLinkOtp('tenant_1', '201223344556', '000000');
    expect(badAttempt).toEqual({ status: 'invalid_or_expired' });

    // Correct OTP -> binds WhatsApp and clears OTP session
    const verified = await service.verifyRepLinkOtp(
      'tenant_1',
      '201223344556',
      challenge!.otpCode,
    );
    expect(verified).toEqual({
      status: 'verified',
      fullName: 'Sara Kamel',
      hubspotOwnerId: '74829104',
      email: 'sara.kamel@company.com',
    });

    // Brute-force protection: 5 wrong attempts evict the OTP session
    await service.requestRepLinkOtp('tenant_1', 'sara.kamel@company.com', '201999999999');
    for (let i = 0; i < 4; i++) {
      const res = await service.verifyRepLinkOtp('tenant_1', '201999999999', '000000');
      expect(res.status).toBe('invalid_or_expired');
    }
    const fifthAttempt = await service.verifyRepLinkOtp('tenant_1', '201999999999', '000000');
    expect(fifthAttempt).toEqual({ status: 'max_attempts_exceeded' });
  });
});

