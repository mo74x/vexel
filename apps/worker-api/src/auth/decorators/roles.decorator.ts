import { SetMetadata } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';

export const ROLES_KEY = 'vexel:roles';
export const OPERATOR_ONLY_KEY = 'vexel:operator_only';
export const OPTIONAL_TENANT_KEY = 'vexel:optional_tenant';

/**
 * Restricts a controller or route handler to specific tenant membership roles (ADMIN, MANAGER, SUPPORT).
 */
export const Roles = (...roles: Array<MembershipRole | `${MembershipRole}`>) =>
  SetMetadata(ROLES_KEY, roles);

/**
 * Restricts a controller or route handler to global Vexel operators (User.isOperator === true).
 */
export const OperatorOnly = () => SetMetadata(OPERATOR_ONLY_KEY, true);

/**
 * Allows a route (such as GET /v1/app/me) to resolve the user even if they have 0 tenant memberships yet,
 * while still binding TenantContext whenever an active tenant is present.
 */
export const OptionalTenant = () => SetMetadata(OPTIONAL_TENANT_KEY, true);

