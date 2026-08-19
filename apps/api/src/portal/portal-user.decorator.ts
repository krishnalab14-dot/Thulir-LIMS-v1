import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { PortalUser } from './portal.types';

/**
 * Stage 8: Injects the authenticated portal user (req.portalUser, set by
 * PortalJwtAuthGuard). Analogous to @CurrentUser() for staff, but read
 * from a separate field to keep the types clean and the boundary explicit.
 */
export const CurrentPortalUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): PortalUser => {
    const request = ctx.switchToHttp().getRequest<{ portalUser?: PortalUser }>();
    if (!request.portalUser) {
      throw new Error('No portal user in request context — are you using PortalJwtAuthGuard?');
    }
    return request.portalUser;
  },
);
