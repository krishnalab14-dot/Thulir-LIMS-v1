import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantStore {
  organizationId: string;
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
 * Holds the current organization id in AsyncLocalStorage so the Prisma
 * extension can scope every query/write without threading orgId through
 * every service method signature.
 */
@Injectable()
export class TenantContextService {
  private readonly als = new AsyncLocalStorage<TenantStore>();

  /** Runs `fn` with `organizationId` as the tenant context in scope. */
  run<T>(organizationId: string, fn: () => T): T {
    return this.als.run({ organizationId }, fn);
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
}
