import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  organizationId: string;
  /** Set when the request carries a valid access token (Stage 7 auth). */
  userId?: string;
}

/**
 * Thrown whenever a tenant-scoped model is queried with no tenant context in
 * scope. The API is fail-closed: this throws instead of silently returning
 * cross-tenant (or all-tenant) data.
 */
export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantContextError';
  }
}

/**
 * Holds the current organization id (and, since Stage 7, the authenticated
 * userId) in AsyncLocalStorage so the Prisma extension can scope every
 * query/write — and services can stamp real actors — without threading
 * orgId/userId through every service method signature.
 */
@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<TenantStore>();

  /** Runs `fn` with `organizationId` as the tenant context in scope. */
  run<T>(organizationId: string, fn: () => T): T {
    return this.als.run({ organizationId }, fn);
  }

  /** Runs `fn` with a full store (tenant + optional authenticated user). */
  runAs<T>(store: TenantStore, fn: () => T): T {
    return this.als.run(store, fn);
  }

  /** Returns the org id in scope, or undefined if no tenant context is set. */
  getOrganizationId(): string | undefined {
    return this.als.getStore()?.organizationId;
  }

  /** Like getOrganizationId() but throws fail-closed when there is none. */
  requireOrganizationId(): string {
    const orgId = this.getOrganizationId();
    if (!orgId) {
      throw new TenantContextError(
        'No tenant context in scope. Wrap the call in TenantContextService.run(organizationId, ...) ' +
          'or route it through the HTTP TenantMiddleware.',
      );
    }
    return orgId;
  }

  /** Returns the authenticated user id in scope, or undefined. */
  getUserId(): string | undefined {
    return this.als.getStore()?.userId;
  }

  /**
   * The real actor for user-scoped columns (createdBy, collectedBy, …).
   * Throws 401 when no authenticated user is in scope — an unauthenticated
   * request must never silently stamp a stub actor. Since the global
   * JwtAuthGuard rejects unauthenticated requests before any service runs,
   * reaching this without a userId means a guard/middleware wiring bug.
   */
  requireUserId(): string {
    const userId = this.getUserId();
    if (!userId) {
      throw new UnauthorizedException('No authenticated user in request context');
    }
    return userId;
  }
}
