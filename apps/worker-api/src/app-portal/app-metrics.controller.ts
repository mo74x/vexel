import {
  Body,
  Controller,
  Get,
  HttpCode,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AppSessionGuard } from '../auth/guards/app-session.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppPortalService, UpdateTenantSettingsDto } from './app-portal.service';

@Controller('v1/app')
@UseGuards(AppSessionGuard)
export class AppMetricsController {
  constructor(private readonly portalService: AppPortalService) {}

  @Get('metrics')
  @HttpCode(200)
  async getMetrics(
    @Req() req: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const tenantId = req.activeTenant?.id;
    return this.portalService.getMetrics(tenantId, from, to);
  }

  @Get('onboarding/status')
  @HttpCode(200)
  async getOnboardingStatus(@Req() req: any) {
    const tenantId = req.activeTenant?.id;
    return this.portalService.getOnboardingStatus(tenantId);
  }

  @Get('settings')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  async getSettings(@Req() req: any) {
    const tenantId = req.activeTenant?.id;
    return this.portalService.getTenantSettings(tenantId);
  }

  @Patch('settings')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  async updateSettings(@Req() req: any, @Body() body: UpdateTenantSettingsDto) {
    const tenantId = req.activeTenant?.id;
    const actorUserId = req.user?.id ?? null;
    return this.portalService.updateTenantSettings(tenantId, actorUserId, body);
  }
}

