import { EnvelopeCryptoService } from '../../crypto/envelope-crypto.service';
import {
  HubSpotOAuthRevokedError,
  HubSpotTokenManagerService,
} from '../hubspot-token-manager.service';

describe('HubSpotTokenManagerService', () => {
  const originalFetch = globalThis.fetch;
  let kvStore: Map<string, string>;
  let tenantRecord: any;
  let mockRedis: any;
  let mockPrisma: any;
  let crypto: EnvelopeCryptoService;
  let manager: HubSpotTokenManagerService;

  beforeEach(() => {
    process.env.VEXEL_KEK_V1 =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
    process.env.HUBSPOT_CLIENT_ID = 'hs_client_id';
    process.env.HUBSPOT_CLIENT_SECRET = 'hs_client_secret';
    process.env.WHATSAPP_SYSTEM_TOKEN = 'global_wa_fallback_token';

    kvStore = new Map<string, string>();
    tenantRecord = {
      id: 'tenant_1',
      hubspotPortalId: '14429103',
      hubspotAccessToken: null,
      hubspotRefreshToken: null,
      hubspotTokenExpires: null,
      whatsappAccessToken: null,
    };

    mockRedis = {
      get: async (key: string) => kvStore.get(key) ?? null,
      set: async (key: string, val: string, ...args: any[]) => {
        if (args.includes('NX') && kvStore.has(key)) {
          return null;
        }
        kvStore.set(key, val);
        return 'OK';
      },
      del: async (key: string) => {
        kvStore.delete(key);
        return 1;
      },
      exists: async (key: string) => (kvStore.has(key) ? 1 : 0),
      eval: async (_script: string, _numKeys: number, key: string, token: string) => {
        if (kvStore.get(key) === token) {
          kvStore.delete(key);
          return 1;
        }
        return 0;
      },
    };

    mockPrisma = {
      tenant: {
        findUnique: async () => tenantRecord,
        findUniqueOrThrow: async () => tenantRecord,
        update: async ({ data }: any) => {
          tenantRecord = { ...tenantRecord, ...data };
          return tenantRecord;
        },
      },
    };

    crypto = new EnvelopeCryptoService();
    manager = new HubSpotTokenManagerService(mockPrisma, mockRedis, crypto);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('seals initial OAuth tokens at rest and serves decrypted token from Redis L1 cache', async () => {
    await manager.sealAndStoreInitialTokens({
      tenantId: 'tenant_1',
      portalId: '14429103',
      rawAccessToken: 'pat_live_access_123',
      rawRefreshToken: 'ref_live_456',
      expiresInSeconds: 1800,
    });

    expect(tenantRecord.hubspotAccessToken).toContain('vexel:enc:v1:');
    expect(tenantRecord.hubspotRefreshToken).toContain('vexel:enc:v1:');

    const token = await manager.getValidAccessToken('tenant_1');
    expect(token).toBe('pat_live_access_123');
  });

  it('rotates expired access token via single-flight mutex and throws HubSpotOAuthRevokedError on 400/401', async () => {
    await manager.sealAndStoreInitialTokens({
      tenantId: 'tenant_1',
      portalId: '14429103',
      rawAccessToken: 'expired_access',
      rawRefreshToken: 'valid_refresh_tok',
      expiresInSeconds: 1800,
    });
    // Evict Redis cache and expire DB timestamp to force refresh
    kvStore.clear();
    tenantRecord.hubspotTokenExpires = new Date(Date.now() - 60_000);

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          access_token: 'rotated_access_999',
          refresh_token: 'rotated_refresh_999',
          expires_in: 1800,
          token_type: 'bearer',
        }),
        { status: 200 },
      )) as any;

    const refreshed = await manager.getValidAccessToken('tenant_1', true);
    expect(refreshed).toBe('rotated_access_999');

    // Simulate permanent OAuth revocation (HTTP 400 BAD_REFRESH_TOKEN)
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: 'BAD_REFRESH_TOKEN', message: 'Revoked' }), {
        status: 400,
      })) as any;

    let caught: any = null;
    try {
      await manager.getValidAccessToken('tenant_1', true);
    } catch (err) {
      caught = err;
    }
    expect(caught instanceof HubSpotOAuthRevokedError).toBe(true);
    expect(caught.isPermanentOAuthError).toBe(true);
  });

  it('seals and decrypts per-tenant WhatsApp access token and falls back to WHATSAPP_SYSTEM_TOKEN when unset', async () => {
    const fallback = await manager.getTenantWhatsAppToken('tenant_1');
    expect(fallback).toBe('global_wa_fallback_token');

    await manager.sealAndStoreTenantWhatsAppToken('tenant_1', 'EAAG_tenant_secret_wa_token');
    expect(tenantRecord.whatsappAccessToken).toContain('vexel:enc:v1:');

    const decrypted = await manager.getTenantWhatsAppToken('tenant_1');
    expect(decrypted).toBe('EAAG_tenant_secret_wa_token');
  });
});

