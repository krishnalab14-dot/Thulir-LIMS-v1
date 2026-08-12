import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NextFunction, Request, Response } from 'express';
import { TenantContextService } from './tenant-context.service';

/**
 * Runs every request inside a tenant context (AsyncLocalStorage).
 *
 * Until the auth stage lands there is no session/org resolution, so the org is
 * taken from the `x-organization-id` request header, falling back to the
 * configured DEFAULT_ORG_ID. The Prisma extension is fail-closed: even if this
 * middleware is bypassed, any tenant-scoped query without a context throws.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly config: ConfigService,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const headerOrg = req.headers['x-organization-id'];
    const orgId =
      typeof headerOrg === 'string' && headerOrg.trim().length > 0
        ? headerOrg.trim()
        : this.config.get<string>('DEFAULT_ORG_ID', 'org_demo');
    this.tenant.run(orgId, () => next());
  }
}
