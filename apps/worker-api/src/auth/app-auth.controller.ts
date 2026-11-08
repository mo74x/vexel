import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { MagicLinkAuthService } from './magic-link-auth.service';
import {
  AppSessionGuard,
  extractSessionTokenFromRequest,
} from './guards/app-session.guard';
import { OptionalTenant } from './decorators/roles.decorator';
import { getVexelOpenApiSpec } from '../openapi/openapi.service';

@Controller('v1/app')
export class AppAuthController {
  constructor(private readonly authService: MagicLinkAuthService) {}

  @Post('auth/magic-link')
  @HttpCode(200)
  async requestMagicLink(
    @Body() body: { email: string; appBaseUrl?: string },
    @Headers('x-forwarded-for') forwardedFor?: string,
    @Req() req?: { ip?: string; socket?: { remoteAddress?: string } },
  ) {
    const clientIp =
      forwardedFor?.split(',')[0]?.trim() ||
      req?.ip ||
      req?.socket?.remoteAddress ||
      '127.0.0.1';

    return this.authService.requestMagicLink({
      email: body?.email,
      clientIp,
      appBaseUrl: body?.appBaseUrl,
    });
  }

  @Post('auth/verify')
  @HttpCode(200)
  async verifyMagicLink(
    @Body() body: { token: string; tenantId?: string },
    @Res({ passthrough: true }) res?: { setHeader?: (name: string, value: string) => void },
  ) {
    const verified = await this.authService.verifyMagicLink({
      token: body?.token,
      preferredTenantId: body?.tenantId,
    });

    res?.setHeader?.('Set-Cookie', verified.cookieHeader);

    return {
      user: verified.user,
      memberships: verified.memberships,
      activeTenant: verified.activeTenant,
      activeRole: verified.activeRole,
    };
  }

  @Post('auth/logout')
  @HttpCode(200)
  async logout(
    @Req() req?: Record<string, any>,
    @Res({ passthrough: true }) res?: { setHeader?: (name: string, value: string) => void },
  ) {
    const sessionToken = extractSessionTokenFromRequest(req ?? {});
    const { cookieHeader } = await this.authService.revokeSession(sessionToken);
    res?.setHeader?.('Set-Cookie', cookieHeader);
    return { status: 'logged_out' };
  }

  @Get('me')
  @UseGuards(AppSessionGuard)
  @OptionalTenant()
  @HttpCode(200)
  async getMe(@Req() req: Record<string, any>) {
    if (req?.auth) {
      return {
        user: req.auth.user,
        memberships: req.auth.memberships,
        activeTenant: req.auth.activeTenant,
        activeRole: req.auth.activeRole,
      };
    }

    const sessionToken = extractSessionTokenFromRequest(req ?? {});
    const requestedTenantId = req?.headers?.['x-vexel-tenant-id'];
    const resolved = await this.authService.resolveSession({
      sessionToken,
      requestedTenantId,
      requireTenant: false,
    });

    return {
      user: resolved.user,
      memberships: resolved.memberships,
      activeTenant: resolved.activeTenant,
      activeRole: resolved.activeRole,
    };
  }

  @Get('openapi.json')
  @HttpCode(200)
  getOpenApiSpec() {
    return getVexelOpenApiSpec();
  }
}

