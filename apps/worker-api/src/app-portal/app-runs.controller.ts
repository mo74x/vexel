import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MembershipRole, RunOutcome, RunStatus } from '@prisma/client';
import { AppSessionGuard } from '../auth/guards/app-session.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppPortalService } from './app-portal.service';

@Controller('v1/app/runs')
@UseGuards(AppSessionGuard)
export class AppRunsController {
  constructor(private readonly portalService: AppPortalService) {}

  @Get()
  @HttpCode(200)
  async listRuns(
    @Req() req: any,
    @Query('status') status?: RunStatus,
    @Query('outcome') outcome?: RunOutcome,
    @Query('repId') repId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    const tenantId = req.activeTenant?.id;
    const role: MembershipRole = req.activeRole ?? MembershipRole.SUPPORT;

    return this.portalService.listRuns({
      tenantId,
      role,
      status,
      outcome,
      repId,
      from,
      to,
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @HttpCode(200)
  async getRunDetail(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.activeTenant?.id;
    const role: MembershipRole = req.activeRole ?? MembershipRole.SUPPORT;

    return this.portalService.getRunDetail(tenantId, id, role);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  async approveRun(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body?: { editedPatch?: Record<string, any> },
  ) {
    const tenantId = req.activeTenant?.id;
    const actorUserId = req.user?.id;

    return this.portalService.approveRun(tenantId, id, actorUserId, body?.editedPatch);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  async rejectRun(
    @Req() req: any,
    @Param('id') id: string,
    @Body() body?: { reason?: string },
  ) {
    const tenantId = req.activeTenant?.id;
    const actorUserId = req.user?.id;

    return this.portalService.rejectRun(tenantId, id, actorUserId, body?.reason);
  }

  @Post(':id/replay')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  async replayRun(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.activeTenant?.id;
    const actorUserId = req.user?.id;

    return this.portalService.replayRun(tenantId, id, actorUserId);
  }
}

