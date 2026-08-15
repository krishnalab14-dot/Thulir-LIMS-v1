import type { Role } from '@prisma/client';

/**
 * The authenticated user attached to `req.user` by JwtAuthGuard and carried
 * in the JWT access-token payload. `sub` (standard) aliases `userId`.
 */
export interface AuthUser {
  userId: string;
  organizationId: string;
  role: Role;
  username: string;
}

/** The access-token JWT payload — contains exactly the AuthUser fields. */
export interface JwtPayload extends AuthUser {
  sub: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
