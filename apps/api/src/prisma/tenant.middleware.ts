import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { NextFunction, Request, Response } from 'express';
import type { JwtPayload } from '../auth/auth.types';
import { TenantContextService } from './tenant-context.service';

/**
 * Runs every request inside a tenant context (AsyncLocalStorage).
 *
 * Stage 7: the tenant comes from the authenticated request's JWT —
 * organizationId and userId are read off the verified access token. The old
 * client-supplied `x-organization-id` header is NO LONGER READ AT ALL: it was
 * always documented as a temporary, spoofable stub, and this is the stage
 * that closes it. Unauthenticated requests (the intentionally-public routes:
 * auth register/login/refresh, public verify-report) fall back to
 * DEFAULT_ORG_ID purely so the fail-closed Prisma extension has a context —
 * they never write tenant data except register's explicit org bootstrap.
 *
 * The guard still re-verifies the token (source of truth for identity); this
 * middleware verifies only to derive the tenant context BEFORE the guards run.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  constructor(
    private readonly tenant: TenantContextService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    const auth = req.headers.authorization;
    let store: { organizationId: string; userId?: string } = {
      organizationId: this.config.get<string>('DEFAULT_ORG_ID', 'org_demo'),
    };

    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      try {
        const payload = this.jwt.verify<JwtPayload>(token);
        store = { organizationId: payload.organizationId, userId: payload.userId };
      } catch {
        // Invalid/expired token: leave the fallback context in place. The
        // JwtAuthGuard rejects the request before any service code runs, so
        // no authenticated-route handler ever sees this context.
      }
    }

    this.tenant.runAs(store, () => next());
  }
}
