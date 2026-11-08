import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  Headers,
  Res,
  HttpCode,
  BadRequestException,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { PrismaService, TenantContext } from '@vexel/database';
import { VexelLockService } from '../redis/vexel-lock.service';
import {
  EnvelopeCryptoService,
  HubSpotHttpClient,
  HubSpotOwnerResolverService,
  HubSpotTokenManagerService,
} from '@vexel/crm-hubspot';
import { PipelineStageCacheService } from '@vexel/extractor';

export interface UpdateTenantSettingsDto {
  name?: string;
  autoSyncThreshold?: number;
  fallbackApprovalPhone?: string;
  whatsappPhoneId?: string;
  rawWhatsAppToken?: string;
}

@Controller('v1')
export class TenantOnboardingController {
  private readonly tokenManager: HubSpotTokenManagerService;
  private readonly ownerResolver: HubSpotOwnerResolverService;
  private readonly stageCache: PipelineStageCacheService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly lockService: VexelLockService,
    @InjectQueue('vexel-workflows') private readonly workflowQueue: Queue,
  ) {
    const rawPrisma = this.prisma.client as unknown as PrismaClient;
    const envelopeCrypto = new EnvelopeCryptoService();
    this.tokenManager = new HubSpotTokenManagerService(
      rawPrisma,
      this.lockService.redis,
      envelopeCrypto,
    );
    const httpClient = new HubSpotHttpClient(this.lockService.redis, this.tokenManager);
    this.ownerResolver = new HubSpotOwnerResolverService(
      this.prisma.client,
      this.lockService.redis,
      httpClient,
    );
    this.stageCache = new PipelineStageCacheService(this.lockService.redis);
  }

  /**
   * GET /v1/hubspot/install?tenantId=...
   * Generates and redirects user to HubSpot's OAuth 2.0 authorization URL with all required scopes.
   */
  @Get('hubspot/install')
  installHubSpot(
    @Query('tenantId') tenantId: string,
    @Query('redirectUri') customRedirectUri: string | undefined,
    @Res() res: { redirect: (url: string) => void },
  ) {
    if (!tenantId) {
      throw new BadRequestException('Query parameter "tenantId" is required');
    }

    const clientId = process.env.HUBSPOT_CLIENT_ID;
    if (!clientId) {
      throw new BadRequestException('HUBSPOT_CLIENT_ID is not configured');
    }

    const redirectUri =
      customRedirectUri ||
      process.env.HUBSPOT_REDIRECT_URI ||
      'http://localhost:3001/v1/hubspot/callback';

    const scopes = [
      'crm.objects.deals.read',
      'crm.objects.deals.write',
      'crm.objects.contacts.read',
      'crm.objects.contacts.write',
      'crm.objects.owners.read',
      'timeline',
    ].join(' ');

    const authUrl =
      `https://app.hubspot.com/oauth/authorize?` +
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: scopes,
        state: tenantId,
      }).toString();

    return res.redirect(authUrl);
  }

  /**
   * GET /v1/hubspot/callback?code=...&state=tenantId
   * Handles HubSpot OAuth callback, seals tokens at rest via EnvelopeCryptoService,
   * stores hubspotPortalId on Tenant, and warms owner routing & deal stage caches.
   */
  @Get('hubspot/callback')
  async hubSpotCallback(
    @Query('code') code: string,
    @Query('state') tenantId: string,
    @Query('redirectUri') customRedirectUri?: string,
  ) {
    if (!code || !tenantId) {
      throw new BadRequestException('Both "code" and "state" (tenantId) are required');
    }

    const redirectUri =
      customRedirectUri ||
      process.env.HUBSPOT_REDIRECT_URI ||
      'http://localhost:3001/v1/hubspot/callback';

    // 1. Exchange authorization code for initial tokens and seal them
    const installed = await this.tokenManager.exchangeAuthorizationCodeAndInstall({
      tenantId,
      code,
      redirectUri,
    });

    // 2. Warm up HubSpot owners cache & PostgreSQL TenantRep records
    let syncedOwnersCount = 0;
    try {
      const ownerSync = await TenantContext.run(tenantId, () =>
        this.ownerResolver.syncAllOwnersFromHubSpot(tenantId),
      );
      syncedOwnersCount = ownerSync.syncedCount;
    } catch {
      // Non-fatal if initial owner fetch hits transient HubSpot error; scheduled sync will catch up
    }

    // 3. Warm up Pipeline Stages cache
    try {
      const validToken = await this.tokenManager.getValidAccessToken(tenantId);
      await this.stageCache.getTenantStages(tenantId, validToken, 'default');
    } catch {
      // Non-fatal cache pre-warming
    }

    // 4. Schedule recurring nightly owner sync for this tenant (every 24h)
    await this.workflowQueue.upsertJobScheduler(
      `recurring-owner-sync:${tenantId}`,
      { pattern: '0 2 * * *' },
      {
        name: 'sync-hubspot-owners',
        data: { tenantId },
        opts: { removeOnComplete: true },
      },
    );

    return {
      status: 'installed_successfully',
      tenantId,
      hubspotPortalId: installed.portalId,
      syncedOwnersCount,
    };
  }

  /**
   * POST /v1/hubspot/disconnect
   * Uninstalls/disconnects HubSpot OAuth for a tenant, purges tokens, and cancels in-flight runs
   */
  @Post('hubspot/disconnect')
  @HttpCode(200)
  async disconnectHubSpot(
    @Headers('x-vexel-api-key') apiKey: string | undefined,
    @Body() body: { tenantId: string },
  ) {
    this.verifyAdminApiKey(apiKey);
    if (!body?.tenantId) {
      throw new BadRequestException('Missing tenantId');
    }

    await this.tokenManager.disconnectTenantOAuth(body.tenantId);

    // Cancel repeatable owner sync job
    await this.workflowQueue.removeJobScheduler(`recurring-owner-sync:${body.tenantId}`).catch(() => {});

    return {
      status: 'disconnected_successfully',
      tenantId: body.tenantId,
    };
  }

  /**
   * GET /v1/tenants/:tenantId/settings
   */
  @Get('tenants/:tenantId/settings')
  async getTenantSettings(
    @Headers('x-vexel-api-key') apiKey: string | undefined,
    @Param('tenantId') tenantId: string,
  ) {
    this.verifyAdminApiKey(apiKey);

    const tenant = await TenantContext.run(tenantId, () =>
      this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          name: true,
          slug: true,
          hubspotPortalId: true,
          whatsappPhoneId: true,
          fallbackApprovalPhone: true,
          autoSyncThreshold: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              tenantReps: true,
              workflowRuns: true,
            },
          },
        },
      }),
    );

    if (!tenant) {
      throw new NotFoundException(`Tenant "${tenantId}" not found`);
    }

    return tenant;
  }

  /**
   * PATCH /v1/tenants/:tenantId/settings
   * Allows tenant admins to update autoSyncThreshold, fallbackApprovalPhone, whatsappPhoneId,
   * or securely upload a dedicated whatsappAccessToken (sealed at rest).
   */
  @Post('tenants/:tenantId/settings')
  @HttpCode(200)
  async updateTenantSettings(
    @Headers('x-vexel-api-key') apiKey: string | undefined,
    @Param('tenantId') tenantId: string,
    @Body() body: UpdateTenantSettingsDto,
  ) {
    this.verifyAdminApiKey(apiKey);

    const updateData: Record<string, any> = {};
    if (body.name !== undefined) updateData.name = body.name;
    if (body.autoSyncThreshold !== undefined) {
      if (body.autoSyncThreshold < 0 || body.autoSyncThreshold > 100) {
        throw new BadRequestException('autoSyncThreshold must be between 0 and 100');
      }
      updateData.autoSyncThreshold = body.autoSyncThreshold;
    }
    if (body.fallbackApprovalPhone !== undefined) {
      updateData.fallbackApprovalPhone = body.fallbackApprovalPhone;
    }
    if (body.whatsappPhoneId !== undefined) {
      updateData.whatsappPhoneId = body.whatsappPhoneId;
    }

    if (Object.keys(updateData).length > 0) {
      await TenantContext.run(tenantId, () =>
        this.prisma.tenant.update({
          where: { id: tenantId },
          data: updateData,
        }),
      );
    }

    if (body.rawWhatsAppToken) {
      await this.tokenManager.sealAndStoreTenantWhatsAppToken(
        tenantId,
        body.rawWhatsAppToken,
      );
    }

    return {
      status: 'updated_successfully',
      tenantId,
      updatedFields: Object.keys(updateData).concat(
        body.rawWhatsAppToken ? ['whatsappAccessToken'] : [],
      ),
    };
  }

  private verifyAdminApiKey(apiKey: string | undefined): void {
    const expected =
      process.env.VEXEL_INTERNAL_API_KEY || process.env.VEXEL_APPROVAL_HMAC_SECRET;
    if (!expected || !apiKey || apiKey !== expected) {
      throw new UnauthorizedException('Missing or invalid admin API key');
    }
  }
}
