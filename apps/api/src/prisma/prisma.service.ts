import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createTenantScopeExtension } from './tenant-scope.extension';
import { TenantContextService } from './tenant-context.service';

/**
 * Exposes a PrismaClient wrapped in the fail-closed tenant-scoping extension.
 *
 * Connection is intentionally lazy (no onModuleInit $connect): the API boots
 * even when PostgreSQL is not reachable yet, and individual queries surface
 * connection errors. A retrying connect on boot would take the whole API down
 * whenever the DB is briefly unavailable.
 */
@Injectable()
export class PrismaService implements OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /** The extended, tenant-scoped client — this is what services should use. */
  readonly prisma: PrismaClient;

  /**
   * The plain, UNextended client — the ALLOWLISTED escape hatch from the
   * fail-closed tenant extension. Two uses only:
   *   1. the tenant extension's own ownership pre-checks (fetchOwnerId);
   *   2. the public-verify service's intentionally tenant-free lookups — order
   *      ids are globally unique and the public endpoint returns a minimal
   *      payload, so scoping by tenant would break printed-QR lookups (the
   *      request carries no tenant hint). Everything else MUST use the
   *      tenant-scoped `prisma` client; a query on `raw` for tenant-scoped
   *      models elsewhere would reintroduce the fail-open gap fixed in Stage 1.
   */
  readonly raw: PrismaClient;

  constructor(tenant: TenantContextService) {
    // The cast keeps the public type as PrismaClient: the extension only
    // intercepts operations at runtime and introduces no new methods.
    this.raw = new PrismaClient();
    this.prisma = this.raw.$extends(createTenantScopeExtension(tenant, this.raw)) as PrismaClient;
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect().catch(() => this.logger.warn('Prisma disconnect failed'));
    await this.raw.$disconnect().catch(() => this.logger.warn('Raw Prisma disconnect failed'));
  }
}
