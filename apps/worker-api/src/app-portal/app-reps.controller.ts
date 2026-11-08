import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { AppSessionGuard } from '../auth/guards/app-session.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppPortalService } from './app-portal.service';

@Controller('v1/app/reps')
@UseGuards(AppSessionGuard)
export class AppRepsController {
  constructor(private readonly portalService: AppPortalService) {}

  @Get()
  @HttpCode(200)
  async listReps(@Req() req: any) {
    const tenantId = req.activeTenant?.id;
    const role: MembershipRole = req.activeRole ?? MembershipRole.SUPPORT;

    return this.portalService.listReps(tenantId, role);
  }

  @Post()
  @HttpCode(201)
  @Roles('ADMIN', 'MANAGER')
  async createRep(
    @Req() req: any,
    @Body()
    body: {
      hubspotOwnerId: string;
      email: string;
      fullName: string;
      whatsappPhone?: string;
      isActive?: boolean;
    },
  ) {
    const tenantId = req.activeTenant?.id;
    const actorUserId = req.user?.id;

    return this.portalService.createRep(tenantId, actorUserId, body);
  }

  @Patch(':id')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  async updateRep(
    @Req() req: any,
    @Param('id') id: string,
    @Body()
    body: {
      fullName?: string;
      email?: string;
      whatsappPhone?: string | null;
      isActive?: boolean;
    },
  ) {
    const tenantId = req.activeTenant?.id;
    const actorUserId = req.user?.id;

    return this.portalService.updateRep(tenantId, id, actorUserId, body);
  }

  @Post(':id/send-link-code')
  @HttpCode(200)
  @Roles('ADMIN', 'MANAGER')
  async sendLinkCode(@Req() req: any, @Param('id') id: string) {
    const tenantId = req.activeTenant?.id;
    const actorUserId = req.user?.id;

    return this.portalService.sendRepLinkCode(tenantId, id, actorUserId);
  }
}

