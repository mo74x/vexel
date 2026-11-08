import {
  Controller,
  Get,
  HttpCode,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AppSessionGuard } from '../auth/guards/app-session.guard';
import { AppPortalService } from './app-portal.service';

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
}

