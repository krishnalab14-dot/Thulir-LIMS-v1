import { SetMetadata } from '@nestjs/common';
import type { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Declares which roles may call a handler. Enforced by the global RolesGuard
 * AFTER JwtAuthGuard has populated req.user — a request from any other role
 * gets a 403. Routes without this decorator are open to every authenticated
 * user (still behind the JwtAuthGuard unless also marked @Public()).
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
