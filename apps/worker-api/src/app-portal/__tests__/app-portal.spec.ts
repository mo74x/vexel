import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MembershipRole, RunOutcome, RunStatus } from '@prisma/client';
import { TenantContext } from '@vexel/database';
import { AppPortalService } from '../app-portal.service';
import { AppRunsController } from '../app-runs.controller';
import { AppRepsController } from '../app-reps.controller';
import { AppMetricsController } from '../app-metrics.controller';
import { AppSessionGuard } from '../../auth/guards/app-session.guard';
import { formatPhoneNumberForRole } from '../utils/phone-mask.util';
import { getVexelOpenApiSpec } from '../../openapi/openapi.service';

describe('Tenant-Scoped Dashboard API (/v1/app)', () => {
  let mockPrisma: any;
  let mockRedis: any;
  let mockQueue: any;
  let queuedJobs: any[];
  let auditLogs: any[];
  let portalService: AppPortalService;
  let runsController: AppRunsController;
  let repsController: AppRepsController;
  let metricsController: AppMetricsController;

  const tenantAlpha = {
    id: 'tenant_alpha',
    name: 'Alpha Corp',
    slug: 'alpha-corp',
    hubspotAccessToken: 'vexel:enc:v1:token_alpha',
    hubspotPortalId: '14429103',
    whatsappAccessToken: 'vexel:enc:v1:wa_alpha',
    whatsappPhoneId: 'wa_phone_alpha',
    fallbackApprovalPhone: '+201011112222',
    autoSyncThreshold: 85,
    manualMinutesPerUpdate: 6,
    locale: 'en',
    timezone: 'Africa/Cairo',
  };

  const tenantBeta = {
    id: 'tenant_beta',
    name: 'Beta LLC',
    slug: 'beta-llc',
    hubspotAccessToken: null,
    hubspotPortalId: null,
    whatsappAccessToken: null,
    whatsappPhoneId: null,
    fallbackApprovalPhone: null,
    autoSyncThreshold: 80,
    manualMinutesPerUpdate: 5,
    locale: 'en',
    timezone: 'Africa/Cairo',
  };

  let mockReps: any[];
  let mockRuns: any[];

  beforeEach(() => {
    process.env.VEXEL_KEK_V1 =
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

    queuedJobs = [];
    auditLogs = [];

    mockReps = [
      {
        id: 'rep_sara',
        tenantId: 'tenant_alpha',
        hubspotOwnerId: 'owner_101',
        email: 'sara@alpha.io',
        fullName: 'Sara Hassan',
        whatsappPhone: '+201012345678',
        isActive: true,
        updatedAt: new Date('2026-11-01T10:00:00Z'),
      },
      {
        id: 'rep_omar',
        tenantId: 'tenant_alpha',
        hubspotOwnerId: 'owner_102',
        email: 'omar@alpha.io',
        fullName: 'Omar Khaled',
        whatsappPhone: null,
        isActive: true,
        updatedAt: new Date('2026-11-01T10:00:00Z'),
      },
      {
        id: 'rep_other_tenant',
        tenantId: 'tenant_beta',
        hubspotOwnerId: 'owner_999',
        email: 'intruder@beta.io',
        fullName: 'Intruder Rep',
        whatsappPhone: '+971501112233',
        isActive: true,
        updatedAt: new Date('2026-11-01T10:00:00Z'),
      },
    ];

    mockRuns = [
      {
        id: 'run_101',
        tenantId: 'tenant_alpha',
        workflowName: 'omnichannel-to-hubspot-v1',
        externalDealId: 'deal_1001',
        status: RunStatus.COMPLETED,
        outcome: RunOutcome.AUTO_SYNCED,
        confidenceScore: 92,
        inputPayload: {
          senderPhone: '+201098765432',
          messages: [{ text: 'Please send agreement for 50k' }],
        },
        extractedData: {
          dealName: 'Cloud Deal Alpha',
          dealStage: 'contractsent',
          amount: 50000,
          summaryNote: 'Sent contract agreement for $50,000.',
        },
        overriddenFields: null,
        errorMessage: null,
        decidedByRepId: 'rep_sara',
        decidedByRep: mockReps[0],
        decidedAt: null,
        undoneAt: null,
        createdAt: new Date('2026-11-08T12:00:00Z'),
        startedAt: new Date('2026-11-08T12:00:00Z'),
        completedAt: new Date('2026-11-08T12:00:05Z'),
        steps: [
          {
            id: 'step_1',
            stepKey: 'step-1-transcribe-window',
            status: 'COMPLETED',
            durationMs: 400,
            executedAt: new Date('2026-11-08T12:00:01Z'),
            errorLog: null,
            outputData: { mergedTranscript: 'Please send agreement for 50k' },
          },
          {
            id: 'step_5',
            stepKey: 'step-5-sync-hubspot-v4',
            status: 'COMPLETED',
            durationMs: 650,
            executedAt: new Date('2026-11-08T12:00:04Z'),
            errorLog: null,
            outputData: { dealId: 'deal_1001' },
          },
        ],
      },
      {
        id: 'run_102',
        tenantId: 'tenant_alpha',
        workflowName: 'omnichannel-to-hubspot-v1',
        externalDealId: null,
        status: RunStatus.WAITING_APPROVAL,
        outcome: null,
        confidenceScore: 68,
        inputPayload: {
          senderPhone: '+201055554444',
          messages: [{ text: 'Review terms please' }],
        },
        extractedData: {
          dealName: 'Draft Alpha Deal',
          dealStage: 'presentationscheduled',
          amount: 25000,
          summaryNote: 'Prospect requested pricing review.',
        },
        overriddenFields: null,
        errorMessage: null,
        decidedByRepId: null,
        decidedByRep: null,
        decidedAt: null,
        undoneAt: null,
        createdAt: new Date('2026-11-08T11:00:00Z'),
        startedAt: new Date('2026-11-08T11:00:00Z'),
        completedAt: null,
        steps: [],
      },
      {
        id: 'run_103',
        tenantId: 'tenant_alpha',
        workflowName: 'omnichannel-to-hubspot-v1',
        externalDealId: null,
        status: RunStatus.FAILED,
        outcome: RunOutcome.FAILED,
        confidenceScore: 40,
        inputPayload: { senderPhone: '+201011112222' },
        extractedData: null,
        overriddenFields: null,
        errorMessage: 'HubSpot API connection timeout',
        decidedByRepId: null,
        decidedByRep: null,
        decidedAt: null,
        undoneAt: null,
        createdAt: new Date('2026-11-08T10:00:00Z'),
        startedAt: new Date('2026-11-08T10:00:00Z'),
        completedAt: new Date('2026-11-08T10:00:15Z'),
        steps: [],
      },
      {
        id: 'run_104_other_tenant',
        tenantId: 'tenant_beta',
        workflowName: 'omnichannel-to-hubspot-v1',
        externalDealId: 'deal_9999',
        status: RunStatus.COMPLETED,
        outcome: RunOutcome.AUTO_SYNCED,
        confidenceScore: 95,
        inputPayload: { senderPhone: '+971500001111' },
        extractedData: { summaryNote: 'Secret Beta Deal' },
        overriddenFields: null,
        errorMessage: null,
        decidedByRepId: 'rep_other_tenant',
        decidedByRep: mockReps[2],
        decidedAt: null,
        undoneAt: null,
        createdAt: new Date('2026-11-08T09:00:00Z'),
        startedAt: new Date('2026-11-08T09:00:00Z'),
        completedAt: new Date('2026-11-08T09:00:04Z'),
        steps: [],
      },
    ];

    const redisStore = new Map<string, string>();
    mockRedis = {
      store: redisStore,
      exists: async (key: string) => (redisStore.has(key) ? 1 : 0),
      get: async (key: string) => redisStore.get(key) ?? null,
      set: async (key: string, val: string) => {
        redisStore.set(key, val);
        return 'OK';
      },
      del: async (...keys: string[]) => {
        let count = 0;
        for (const k of keys) {
          if (redisStore.delete(k)) count++;
        }
        return count;
      },
    };

    mockQueue = {
      add: async (name: string, data: any, opts: any) => {
        queuedJobs.push({ name, data, opts });
        return { id: opts?.jobId ?? 'job_id' };
      },
    };

    mockPrisma = {
      tenant: {
        findUnique: async ({ where }: any) => {
          if (where.id === 'tenant_alpha') return tenantAlpha;
          if (where.id === 'tenant_beta') return tenantBeta;
          return null;
        },
        update: async ({ where, data }: any) => {
          const tenant = where.id === 'tenant_alpha' ? tenantAlpha : tenantBeta;
          if (tenant) Object.assign(tenant, data);
          return tenant;
        },
      },
      workflowRun: {
        findMany: async ({ where, take, skip, cursor }: any) => {
          let items = mockRuns.filter((r) => r.tenantId === where.tenantId);

          if (where.status) items = items.filter((r) => r.status === where.status);
          if (where.outcome) items = items.filter((r) => r.outcome === where.outcome);
          if (where.decidedByRepId) items = items.filter((r) => r.decidedByRepId === where.decidedByRepId);

          if (where.createdAt?.gte) {
            items = items.filter((r) => r.createdAt >= where.createdAt.gte);
          }
          if (where.createdAt?.lte) {
            items = items.filter((r) => r.createdAt <= where.createdAt.lte);
          }

          items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

          if (cursor) {
            const idx = items.findIndex((i) => i.id === cursor.id);
            if (idx !== -1) {
              items = items.slice(idx + (skip ? 1 : 0));
            }
          }

          return items.slice(0, take);
        },
        findFirst: async ({ where }: any) => {
          return (
            mockRuns.find((r) => {
              if (where.tenantId && r.tenantId !== where.tenantId) return false;
              if (where.id && r.id !== where.id) return false;
              return true;
            }) ?? null
          );
        },
        update: async ({ where, data }: any) => {
          const run = mockRuns.find((r) => r.id === where.id);
          if (run) Object.assign(run, data);
          return run;
        },
        count: async ({ where }: any) => {
          return mockRuns.filter((r) => r.tenantId === where.tenantId).length;
        },
      },
      tenantRep: {
        findMany: async ({ where }: any) => {
          return mockReps.filter((r) => r.tenantId === where.tenantId);
        },
        findFirst: async ({ where }: any) => {
          return mockReps.find((r) => r.id === where.id && r.tenantId === where.tenantId) ?? null;
        },
        findUnique: async ({ where }: any) => {
          if (where.id) return mockReps.find((r) => r.id === where.id) ?? null;
          if (where.tenantId_email) {
            return (
              mockReps.find(
                (r) =>
                  r.tenantId === where.tenantId_email.tenantId &&
                  r.email === where.tenantId_email.email,
              ) ?? null
            );
          }
          if (where.tenantId_hubspotOwnerId) {
            return (
              mockReps.find(
                (r) =>
                  r.tenantId === where.tenantId_hubspotOwnerId.tenantId &&
                  r.hubspotOwnerId === where.tenantId_hubspotOwnerId.hubspotOwnerId,
              ) ?? null
            );
          }
          return null;
        },
        create: async ({ data }: any) => {
          const rep = { id: `rep_${Date.now()}`, ...data, updatedAt: new Date() };
          mockReps.push(rep);
          return rep;
        },
        update: async ({ where, data }: any) => {
          const rep = mockReps.find((r) => r.id === where.id);
          if (rep) Object.assign(rep, data);
          return rep;
        },
        count: async ({ where }: any) => {
          return mockReps.filter((r) => {
            if (r.tenantId !== where.tenantId) return false;
            if (where.whatsappPhone?.not === null && r.whatsappPhone === null) return false;
            if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
            return true;
          }).length;
        },
      },
      usageLedger: {
        aggregate: async ({ where }: any) => {
          return {
            _sum: {
              estimatedCostUsd: where.tenantId === 'tenant_alpha' ? 0.0485 : 0,
            },
          };
        },
      },
      auditLog: {
        create: async ({ data }: any) => {
          auditLogs.push(data);
          return { id: `aud_${auditLogs.length}`, ...data };
        },
      },
    };

    const mockLockService: any = { redis: mockRedis };

    portalService = new AppPortalService(mockPrisma, mockLockService, mockQueue);
    runsController = new AppRunsController(portalService);
    repsController = new AppRepsController(portalService);
    metricsController = new AppMetricsController(portalService);
  });

  describe('Phone Number Masking Utility', () => {
    it('reveals full unmasked phone number for ADMIN and masks all but last 3 digits for non-ADMIN', () => {
      const phone = '+201012345678';

      expect(formatPhoneNumberForRole(phone, MembershipRole.ADMIN)).toBe('+201012345678');
      expect(formatPhoneNumberForRole(phone, MembershipRole.MANAGER)).toBe('+*********678');
      expect(formatPhoneNumberForRole(phone, MembershipRole.SUPPORT)).toBe('+*********678');
      expect(formatPhoneNumberForRole(null, MembershipRole.MANAGER)).toBeNull();
    });
  });

  describe('GET /v1/app/runs (Cursor Pagination, Filtering & Privacy)', () => {
    it('returns cursor-paginated runs newest first and masks phone numbers for non-ADMIN', async () => {
      const reqSupport = {
        activeTenant: { id: 'tenant_alpha' },
        activeRole: MembershipRole.SUPPORT,
      };

      const res = await runsController.listRuns(
        reqSupport,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        '2',
      );

      expect(res.items.length).toBe(2);
      expect(res.hasMore).toBe(true);
      expect(res.items[0].id).toBe('run_101');
      expect(res.items[1].id).toBe('run_102');
      expect(res.items[0].senderPhone).toBe('+*********432'); // Masked for SUPPORT
      expect(res.items[0].decidedByRep?.whatsappPhone).toBe('+*********678');
      expect(res.items[0].oneLineSummary).toContain('Sent contract agreement');

      // Next page via cursor
      const nextPage = await runsController.listRuns(
        reqSupport,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        res.nextCursor!,
        '2',
      );

      expect(nextPage.items.length).toBe(1);
      expect(nextPage.items[0].id).toBe('run_103');
      expect(nextPage.hasMore).toBe(false);
    });

    it('returns unmasked phone numbers for ADMIN role and applies status filtering', async () => {
      const reqAdmin = {
        activeTenant: { id: 'tenant_alpha' },
        activeRole: MembershipRole.ADMIN,
      };

      const res = await runsController.listRuns(reqAdmin, RunStatus.WAITING_APPROVAL);

      expect(res.items.length).toBe(1);
      expect(res.items[0].id).toBe('run_102');
      expect(res.items[0].status).toBe(RunStatus.WAITING_APPROVAL);
      expect(res.items[0].senderPhone).toBe('+201055554444'); // Full unmasked for ADMIN
    });
  });

  describe('GET /v1/app/runs/:id (Detail View & Undo Check)', () => {
    it('returns run details with steps, transcript, and detects active Redis undo snapshot', async () => {
      // Arm Redis with standard undo snapshot for run_101
      await mockRedis.set('vexel:undo:tenant_alpha:run_101', JSON.stringify({ dealId: 'deal_1001' }));

      const reqManager = {
        activeTenant: { id: 'tenant_alpha' },
        activeRole: MembershipRole.MANAGER,
      };

      const detail = await runsController.getRunDetail(reqManager, 'run_101');

      expect(detail.id).toBe('run_101');
      expect(detail.undoAvailable).toBe(true);
      expect(detail.undoType).toBe('STANDARD');
      expect(detail.transcript).toBe('Please send agreement for 50k');
      expect(detail.steps.length).toBe(2);
      expect(detail.steps[0].stepKey).toBe('step-1-transcribe-window');
      expect(detail.senderPhone).toBe('+*********432');
    });

    it('denies access to runs belonging to a different tenant with 404 NotFoundException', async () => {
      const reqAlpha = {
        activeTenant: { id: 'tenant_alpha' },
        activeRole: MembershipRole.ADMIN,
      };

      await expect(runsController.getRunDetail(reqAlpha, 'run_104_other_tenant')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('Run Action Endpoints: /approve, /reject, /replay', () => {
    const adminReq = {
      activeTenant: { id: 'tenant_alpha' },
      activeRole: MembershipRole.ADMIN,
      user: { id: 'usr_admin_1' },
    };

    it('approves a WAITING_APPROVAL run with optional patch, queues BullMQ job, and records AuditLog', async () => {
      const res = await runsController.approveRun(adminReq, 'run_102', {
        editedPatch: { amount: 30000 },
      });

      expect(res).toEqual({ status: 'workflow_resumed', runId: 'run_102' });
      expect(queuedJobs.length).toBe(1);
      expect(queuedJobs[0].data.tenantId).toBe('tenant_alpha');
      expect(queuedJobs[0].data.runId).toBe('run_102');
      expect(queuedJobs[0].data.mode).toBe('RESUME_AFTER_APPROVAL');
      expect(queuedJobs[0].data.approved).toBe(true);
      expect(queuedJobs[0].data.editedPatch).toEqual({ amount: 30000 });
      expect(queuedJobs[0].data.actorUserId).toBe('usr_admin_1');

      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].tenantId).toBe('tenant_alpha');
      expect(auditLogs[0].action).toBe('workflow_run.app_approved');
      expect(auditLogs[0].actorUserId).toBe('usr_admin_1');
      expect(auditLogs[0].targetId).toBe('run_102');
    });

    it('rejects a WAITING_APPROVAL run and queues rejection resume job with AuditLog', async () => {
      const res = await runsController.rejectRun(adminReq, 'run_102', { reason: 'Wrong contact' });

      expect(res).toEqual({ status: 'workflow_rejected', runId: 'run_102' });
      expect(queuedJobs.at(-1)?.data.approved).toBe(false);
      expect(auditLogs.at(-1)?.action).toBe('workflow_run.app_rejected');
    });

    it('throws BadRequestException when attempting to approve or reject a non-WAITING_APPROVAL run', async () => {
      await expect(runsController.approveRun(adminReq, 'run_101')).rejects.toThrow(BadRequestException);
      await expect(runsController.rejectRun(adminReq, 'run_101')).rejects.toThrow(BadRequestException);
    });

    it('replays a FAILED run, resets status to RUNNING, queues initial ingest job, and writes AuditLog', async () => {
      const res = await runsController.replayRun(adminReq, 'run_103');

      expect(res.status).toBe('dlq_run_requeued');
      expect(res.runId).toBe('run_103');
      expect(mockRuns.find((r) => r.id === 'run_103')?.status).toBe(RunStatus.RUNNING);
      expect(auditLogs.at(-1)?.action).toBe('workflow_run.app_replayed');
    });
  });

  describe('Sales Rep Endpoints (/reps)', () => {
    const adminReq = {
      activeTenant: { id: 'tenant_alpha' },
      activeRole: MembershipRole.ADMIN,
      user: { id: 'usr_admin_1' },
    };

    const managerReq = {
      activeTenant: { id: 'tenant_alpha' },
      activeRole: MembershipRole.MANAGER,
      user: { id: 'usr_mgr_1' },
    };

    it('lists reps for the tenant with role-based phone masking', async () => {
      const listForAdmin = await repsController.listReps(adminReq);
      expect(listForAdmin.length).toBe(2);
      expect(listForAdmin[0].whatsappPhone).toBe('+201012345678');

      const listForManager = await repsController.listReps(managerReq);
      expect(listForManager[0].whatsappPhone).toBe('+*********678');
    });

    it('creates a new rep and updates existing rep details', async () => {
      const created = await repsController.createRep(adminReq, {
        hubspotOwnerId: 'owner_200',
        email: 'nouran@alpha.io',
        fullName: 'Nouran Ali',
        whatsappPhone: '+201077778888',
      });

      expect(created.fullName).toBe('Nouran Ali');
      expect(auditLogs.at(-1)?.action).toBe('rep.created');

      const updated = await repsController.updateRep(managerReq, created.id, {
        isActive: false,
      });

      expect(updated.isActive).toBe(false);
      expect(auditLogs.at(-1)?.action).toBe('rep.updated');
    });

    it('sends OTP link code and denies cross-tenant rep operations', async () => {
      const otpRes = await repsController.sendLinkCode(adminReq, 'rep_sara');
      expect(otpRes.status).toBe('otp_sent');
      expect(otpRes.email).toBe('sara@alpha.io');

      // Attempting to send link code to rep from tenant_beta is denied with NotFoundException
      await expect(repsController.sendLinkCode(adminReq, 'rep_other_tenant')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('validates E.164 phone numbers and rejects invalid formats on rep create and update', async () => {
      await expect(
        repsController.createRep(adminReq, {
          hubspotOwnerId: 'owner_201',
          email: 'invalid@alpha.io',
          fullName: 'Invalid Rep',
          whatsappPhone: '01012345678', // missing + and country code
        }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        repsController.updateRep(managerReq, 'rep_sara', {
          whatsappPhone: 'invalid-phone-string',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Metrics, Settings & Onboarding Status (/metrics, /settings, /onboarding/status)', () => {
    const req = {
      activeTenant: { id: 'tenant_alpha' },
      activeRole: MembershipRole.MANAGER,
    };

    it('calculates aggregate metrics, outcome rates, estimated minutes saved, and UsageLedger cost', async () => {
      const metrics = await metricsController.getMetrics(req);

      expect(metrics.totalRuns).toBe(3);
      expect(metrics.runsByOutcome[RunOutcome.AUTO_SYNCED]).toBe(1);
      expect(metrics.runsByOutcome[RunOutcome.FAILED]).toBe(1);
      expect(metrics.autoSyncRate).toBe(33.3); // 1 / 3 * 100
      expect(metrics.manualMinutesPerUpdate).toBe(6);
      expect(metrics.estimatedMinutesSaved).toBe(6); // 1 synced run * 6 min
      expect(metrics.totalCostUsd).toBe(0.0485);
      expect(metrics.costPerRun).toBe(0.0162);
      expect(metrics.dailyBuckets.length > 0).toBe(true);
      expect(metrics.repsActivity.length).toBe(1);
      expect(metrics.repsActivity[0].repId).toBe('rep_sara');
      expect(metrics.repsActivity[0].autoSyncedCount).toBe(1);
    });

    it('returns onboarding integration status for the active tenant', async () => {
      const status = await metricsController.getOnboardingStatus(req);

      expect(status.tenantId).toBe('tenant_alpha');
      expect(status.hubspotConnected).toBe(true);
      expect(status.whatsappConnected).toBe(true);
      expect(status.repsLinkedCount).toBe(1); // Sara has whatsappPhone, Omar does not
      expect(status.totalRepsCount).toBe(2);
      expect(status.firstRunReceived).toBe(true);
    });

    it('returns workspace settings without exposing tokens', async () => {
      const settings = await metricsController.getSettings(req);

      expect(settings.id).toBe('tenant_alpha');
      expect(settings.hubspotConnected).toBe(true);
      expect(settings.whatsappConnected).toBe(true);
      expect(settings.autoSyncThreshold).toBe(85);
      expect(settings.fallbackApprovalPhone).toBe('+201011112222');
      expect((settings as any).hubspotAccessToken).toBeUndefined();
      expect((settings as any).whatsappAccessToken).toBeUndefined();
      expect((settings as any).rawWhatsAppToken).toBeUndefined();
    });

    it('updates tenant settings, seals rawWhatsAppToken, and enforces E.164 validation', async () => {
      const updated = await metricsController.updateSettings(
        { ...req, user: { id: 'usr_admin_1' } },
        {
          autoSyncThreshold: 90,
          fallbackApprovalPhone: '+201099998888',
          whatsappPhoneId: 'wa_phone_new',
          rawWhatsAppToken: 'EAAG_fresh_meta_token_12345',
        },
      );

      expect(updated.autoSyncThreshold).toBe(90);
      expect(updated.fallbackApprovalPhone).toBe('+201099998888');
      expect(updated.whatsappPhoneId).toBe('wa_phone_new');
      expect(tenantAlpha.whatsappAccessToken).toContain('vexel:enc:');
      expect(auditLogs.at(-1)?.action).toBe('settings.updated');

      // Invalid E.164 fallback phone throws
      await expect(
        metricsController.updateSettings(req, {
          fallbackApprovalPhone: '01099998888',
        }),
      ).rejects.toThrow(BadRequestException);

      // Invalid threshold throws
      await expect(
        metricsController.updateSettings(req, {
          autoSyncThreshold: 150,
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('OpenAPI 3.1 Spec Document', () => {
    it('serves valid OpenAPI 3.1 schema covering all /v1/app endpoints', () => {
      const spec = getVexelOpenApiSpec();

      expect(spec.openapi).toBe('3.1.0');
      expect(spec.paths['/runs']).toBeDefined();
      expect(spec.paths['/runs/{id}']).toBeDefined();
      expect(spec.paths['/runs/{id}/approve']).toBeDefined();
      expect(spec.paths['/runs/{id}/reject']).toBeDefined();
      expect(spec.paths['/runs/{id}/replay']).toBeDefined();
      expect(spec.paths['/reps']).toBeDefined();
      expect(spec.paths['/metrics']).toBeDefined();
      expect(spec.paths['/onboarding/status']).toBeDefined();
      expect(spec.paths['/settings']).toBeDefined();
    });
  });
});
