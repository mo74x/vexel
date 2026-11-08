import { TenantOnboardingController } from '../tenant-onboarding.controller';

describe('TenantOnboardingController', () => {
  let mockPrisma: any;
  let mockLockService: any;
  let mockQueue: any;
  let controller: TenantOnboardingController;
  let tenantStore: Map<string, any>;

  beforeEach(() => {
    process.env.VEXEL_INTERNAL_API_KEY = 'test_admin_api_key_123';
    process.env.HUBSPOT_CLIENT_ID = 'test_hs_client_id';
    process.env.HUBSPOT_CLIENT_SECRET = 'test_hs_client_secret';
    process.env.VEXEL_KEK_V1 =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    tenantStore = new Map<string, any>([
      [
        'tenant_acme',
        {
          id: 'tenant_acme',
          name: 'Acme Corp',
          slug: 'acme',
          hubspotPortalId: '14429103',
          whatsappPhoneId: 'wa_phone_100',
          fallbackApprovalPhone: '+201000000001',
          autoSyncThreshold: 85,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { tenantReps: 5, workflowRuns: 12 },
        },
      ],
    ]);

    mockPrisma = {
      client: {
        tenant: {
          findUnique: async ({ where }: any) => tenantStore.get(where.id) ?? null,
          update: async ({ where, data }: any) => {
            const existing = tenantStore.get(where.id);
            const updated = { ...existing, ...data };
            tenantStore.set(where.id, updated);
            return updated;
          },
        },
      },
      tenant: {
        findUnique: async ({ where }: any) => tenantStore.get(where.id) ?? null,
        update: async ({ where, data }: any) => {
          const existing = tenantStore.get(where.id);
          const updated = { ...existing, ...data };
          tenantStore.set(where.id, updated);
          return updated;
        },
      },
    };

    mockLockService = {
      redis: {
        get: async () => null,
        set: async () => 'OK',
        del: async () => 1,
      },
    };

    mockQueue = {
      upsertJobScheduler: async () => {},
      removeJobScheduler: async () => {},
    };

    controller = new TenantOnboardingController(mockPrisma, mockLockService, mockQueue);
  });

  describe('GET /v1/hubspot/install', () => {
    it('redirects user to HubSpot OAuth authorization URL with configured scopes and state', () => {
      let redirectedUrl = '';
      const mockRes = {
        redirect: (url: string) => {
          redirectedUrl = url;
        },
      };

      controller.installHubSpot('tenant_acme', undefined, mockRes);
      expect(redirectedUrl).toContain('https://app.hubspot.com/oauth/authorize?');
      expect(redirectedUrl).toContain('client_id=test_hs_client_id');
      expect(redirectedUrl).toContain('state=tenant_acme');
      expect(redirectedUrl).toContain('crm.objects.deals.read');
      expect(redirectedUrl).toContain('timeline');
    });

    it('throws BadRequestException if tenantId is missing', () => {
      expect(() => controller.installHubSpot('', undefined, {} as any)).toThrow(
        /Query parameter "tenantId" is required/,
      );
    });
  });

  describe('GET /v1/hubspot/callback', () => {
    it('exchanges code for tokens, seals them at rest, and registers repeatable owner sync', async () => {
      let schedulerKey = '';
      (controller as any).tokenManager = {
        exchangeAuthorizationCodeAndInstall: async () => ({
          portalId: '14429103',
          expiresInSeconds: 1800,
        }),
        getValidAccessToken: async () => 'test_access_token',
      };
      (controller as any).ownerResolver = {
        syncAllOwnersFromHubSpot: async () => ({ syncedCount: 8 }),
      };
      (controller as any).stageCache = {
        getTenantStages: async () => [],
      };
      (controller as any).workflowQueue = {
        upsertJobScheduler: async (key: string) => {
          schedulerKey = key;
        },
      };

      const result = await controller.hubSpotCallback('test_auth_code', 'tenant_acme');
      expect(result).toEqual({
        status: 'installed_successfully',
        tenantId: 'tenant_acme',
        hubspotPortalId: '14429103',
        syncedOwnersCount: 8,
      });
      expect(schedulerKey).toBe('recurring-owner-sync:tenant_acme');
    });
  });

  describe('POST /v1/hubspot/disconnect', () => {
    it('disconnects tenant OAuth, clears tokens, and cancels repeatable owner sync', async () => {
      let disconnectedTenantId = '';
      let removedScheduler = '';
      (controller as any).tokenManager = {
        disconnectTenantOAuth: async (tid: string) => {
          disconnectedTenantId = tid;
        },
      };
      (controller as any).workflowQueue = {
        removeJobScheduler: async (key: string) => {
          removedScheduler = key;
        },
      };

      const res = await controller.disconnectHubSpot('test_admin_api_key_123', {
        tenantId: 'tenant_acme',
      });
      expect(res).toEqual({
        status: 'disconnected_successfully',
        tenantId: 'tenant_acme',
      });
      expect(disconnectedTenantId).toBe('tenant_acme');
      expect(removedScheduler).toBe('recurring-owner-sync:tenant_acme');
    });

    it('rejects unauthenticated requests without valid admin API key', async () => {
      await expect(
        controller.disconnectHubSpot('wrong_key', { tenantId: 'tenant_acme' }),
      ).rejects.toThrow(/Missing or invalid admin API key/);
    });
  });

  describe('Tenant Settings API', () => {
    it('reads tenant settings via GET /v1/tenants/:tenantId/settings', async () => {
      const settings = await controller.getTenantSettings(
        'test_admin_api_key_123',
        'tenant_acme',
      );
      expect(settings.name).toBe('Acme Corp');
      expect(settings.autoSyncThreshold).toBe(85);
      expect(settings.hubspotPortalId).toBe('14429103');
    });

    it('updates tenant autoSyncThreshold, phoneId, and seals custom WhatsApp token', async () => {
      let sealedTenantId = '';
      let sealedRawToken = '';
      (controller as any).tokenManager.sealAndStoreTenantWhatsAppToken = async (
        tid: string,
        tok: string,
      ) => {
        sealedTenantId = tid;
        sealedRawToken = tok;
      };

      const updateRes = await controller.updateTenantSettings(
        'test_admin_api_key_123',
        'tenant_acme',
        {
          autoSyncThreshold: 90,
          fallbackApprovalPhone: '+201099999999',
          rawWhatsAppToken: 'EAAG_test_custom_tenant_token',
        },
      );

      expect(updateRes.status).toBe('updated_successfully');
      expect(updateRes.updatedFields).toContain('autoSyncThreshold');
      expect(updateRes.updatedFields).toContain('fallbackApprovalPhone');
      expect(updateRes.updatedFields).toContain('whatsappAccessToken');
      expect(sealedTenantId).toBe('tenant_acme');
      expect(sealedRawToken).toBe('EAAG_test_custom_tenant_token');

      const updated = tenantStore.get('tenant_acme');
      expect(updated.autoSyncThreshold).toBe(90);
      expect(updated.fallbackApprovalPhone).toBe('+201099999999');
    });
  });
});

