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

  /** The plain, UNextended client used by the tenant extension's ownership pre-checks. */
  private readonly raw: PrismaClient;

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
