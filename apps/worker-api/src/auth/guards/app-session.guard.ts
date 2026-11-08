import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole } from '@prisma/client';
import { tenantStorage } from '@vexel/database';
import {
  MagicLinkAuthService,
  ResolvedAuthContext,
  SESSION_COOKIE_NAME,
} from '../magic-link-auth.service';
import {
  OPERATOR_ONLY_KEY,
  OPTIONAL_TENANT_KEY,
  ROLES_KEY,
} from '../decorators/roles.decorator';

export function extractSessionTokenFromRequest(req: Record<string, any>): string | undefined {
  // 1. Check Cookie header for vexel_session=<token>
  const cookieHeader: string | undefined = req?.headers?.cookie;
  if (cookieHeader && typeof cookieHeader === 'string') {
    const pairs = cookieHeader.split(';');
    for (const pair of pairs) {
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key === SESSION_COOKIE_NAME && val) {
        return decodeURIComponent(val);
      }
    }
  }

  // 2. Fallback to parsed req.cookies if cookie-parser middleware is present
  if (req?.cookies?.[SESSION_COOKIE_NAME]) {
    return String(req.cookies[SESSION_COOKIE_NAME]);
  }

  // 3. Fallback to Authorization: Bearer <token> for SSR/CLI/tests
  const authHeader: string | undefined = req?.headers?.authorization;
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    if (token) return token;
  }

  return undefined;
}

function readMetadata<T>(
  reflector: Reflector | undefined,
  key: string,
  context: ExecutionContext,
): T | undefined {
  const handler = context.getHandler?.();
  const cls = context.getClass?.();
  if (reflector) {
    return reflector.getAllAndOverride<T>(key, [handler, cls]);
  }
  return (
    (handler ? Reflect.getMetadata(key, handler) : undefined) ??
    (cls ? Reflect.getMetadata(key, cls) : undefined)
  );
}

@Injectable()
export class AppSessionGuard implements CanActivate {
  constructor(
    private readonly authService: MagicLinkAuthService,
    @Optional() private readonly reflector?: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Enter AsyncLocalStorage synchronously before the first `await` so the caller's
    // async continuation (Express/NestJS request pipeline) shares this exact store reference.
    const store = { tenantId: null as string | null, bypassRls: false };
    tenantStorage.enterWith(store);

    try {
      const req = context.switchToHttp().getRequest();
      const sessionToken = extractSessionTokenFromRequest(req);
      const requestedTenantId =
        (req?.headers?.['x-vexel-tenant-id'] as string | undefined) ?? undefined;

      const isOperatorOnly = Boolean(
        readMetadata<boolean>(this.reflector, OPERATOR_ONLY_KEY, context),
      );
      const isOptionalTenant = Boolean(
        readMetadata<boolean>(this.reflector, OPTIONAL_TENANT_KEY, context),
      );
      const requiredRoles =
        readMetadata<MembershipRole[]>(this.reflector, ROLES_KEY, context) ?? [];

      const resolved: ResolvedAuthContext = await this.authService.resolveSession({
        sessionToken,
        requestedTenantId,
        requireTenant: !isOptionalTenant && !isOperatorOnly,
      });

      // 1. Enforce @OperatorOnly() if present
      if (isOperatorOnly && !resolved.user.isOperator) {
        throw new ForbiddenException('Operator privileges required');
      }

      // 2. Enforce @Roles(...) against active tenant membership role
      if (requiredRoles.length > 0) {
        if (!resolved.activeTenant || !resolved.activeRole) {
          throw new ForbiddenException('Active tenant membership required for this resource');
        }
        if (!requiredRoles.includes(resolved.activeRole)) {
          throw new ForbiddenException(
            `Insufficient role "${resolved.activeRole}": requires one of [${requiredRoles.join(', ')}]`,
          );
        }
      }

      // 3. Attach resolved identity, memberships, active tenant, and role to request
      req.auth = resolved;
      req.user = resolved.user;
      req.activeTenant = resolved.activeTenant;
      req.activeRole = resolved.activeRole;

      // 4. Populate the bound TenantContext store so all downstream Prisma queries enforce RLS
      if (resolved.activeTenant) {
        store.tenantId = resolved.activeTenant.id;
        store.bypassRls = false;
        tenantStorage.enterWith(store);
      } else if (resolved.user.isOperator && isOperatorOnly) {
        store.tenantId = null;
        store.bypassRls = true;
        tenantStorage.enterWith(store);
      }

      return true;
    } catch (err) {
      tenantStorage.enterWith(undefined as any);
      throw err;
    }
  }
}
