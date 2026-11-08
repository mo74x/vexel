import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { tenantStorage } from '@vexel/database';
import { MagicLinkAuthService, ResolvedAuthContext } from '../magic-link-auth.service';
import { extractSessionTokenFromRequest } from './app-session.guard';

@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(private readonly authService: MagicLinkAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const store = { tenantId: null as string | null, bypassRls: false };
    tenantStorage.enterWith(store);

    try {
      const req = context.switchToHttp().getRequest();

      let resolved: ResolvedAuthContext | undefined = req.auth;
      if (!resolved) {
        const sessionToken = extractSessionTokenFromRequest(req);
        const requestedTenantId =
          (req?.headers?.['x-vexel-tenant-id'] as string | undefined) ?? undefined;

        resolved = await this.authService.resolveSession({
          sessionToken,
          requestedTenantId,
          requireTenant: false,
        });

        req.auth = resolved;
        req.user = resolved.user;
        req.activeTenant = resolved.activeTenant;
        req.activeRole = resolved.activeRole;
      }

      if (!resolved.user?.isOperator) {
        throw new ForbiddenException('Operator privileges required');
      }

      if (resolved.activeTenant) {
        store.tenantId = resolved.activeTenant.id;
        store.bypassRls = false;
      } else {
        store.tenantId = null;
        store.bypassRls = true;
      }
      tenantStorage.enterWith(store);

      return true;
    } catch (err) {
      tenantStorage.enterWith(undefined as any);
      throw err;
    }
  }
}
