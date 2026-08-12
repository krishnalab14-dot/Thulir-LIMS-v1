/* eslint-disable @typescript-eslint/no-explicit-any -- $allModels hooks receive loosely-typed Prisma internals; the casts are intentional and isolated to this file. */
import { Prisma, PrismaClient } from '@prisma/client';
import { TenantContextError, TenantContextService } from './tenant-context.service';

/**
 * Models carrying an `organizationId` column — every operation on these is
 * tenant-scoped. PaymentSplit is intentionally absent (no orgId column; it
 * inherits tenancy from Payment). UidCounter is an internal counter table.
 */
const TENANT_MODELS = new Set([
  'User',
  'Patient',
  'MasterTest',
  'MasterTestPackage',
  'MasterTestPackageItem',
  'SampleType',
  'Party',
  'Order',
  'OrderTest',
  'Invoice',
  'Payment',
  'Sample',
  'TestSpecification',
]);

/** Pure helper: AND-combine a caller's where with a hard organizationId filter. */
export function applyTenantWhere(where: unknown, organizationId: string): Record<string, unknown> {
  const base = where && typeof where === 'object' ? { ...(where as Record<string, unknown>) } : {};
  return { AND: [base, { organizationId }] };
}

/** Pure helper: reject write payloads that claim a different organization. */
export function assertDataOwnedByTenant(data: unknown, organizationId: string, model: string): void {
  if (data && typeof data === 'object') {
    const claimed = (data as Record<string, unknown>).organizationId;
    if (claimed !== undefined && claimed !== organizationId) {
      throw new TenantContextError(
        `Refusing to write ${model} row claimed for organization ${String(claimed)} inside tenant context ${organizationId}`,
      );
    }
  }
}

/** Pure helper: reject a fetched row that belongs to another organization. */
export function assertRowOwnedByTenant(row: unknown, organizationId: string, model: string): void {
  if (row && typeof row === 'object') {
    const actual = (row as Record<string, unknown>).organizationId;
    if (actual !== undefined && actual !== organizationId) {
      throw new TenantContextError(`Cross-tenant access blocked: ${model} row belongs to organization ${String(actual)}`);
    }
  }
}

/**
 * Fail-closed tenant scoping:
 *  - reads  (findMany/findFirst/count/aggregate/groupBy) → orgId ANDed into `where`
 *  - point reads (findUnique)                     → post-verified against the fetched row
 *  - creates                                      → orgId injected (or verified if already set)
 *  - update/delete/upsert by unique id            → ownership verified (see below)
 *  - updateMany/deleteMany                        → orgId ANDed into `where`
 *  - no tenant context in scope                   → TenantContextError (fail-closed)
 *
 * Raw `$queryRaw`/`$executeRaw` calls are NOT intercepted; they are only used
 * for the atomic UidCounter increment and must set orgId explicitly.
 *
 * update/delete/upsert ownership is checked TWICE, and this is deliberate —
 * both were discovered to be necessary by the real-DB verification:
 *  1. PRE-check on `raw` (a plain, UNextended PrismaClient closed over by the
 *     factory): fails fast before any mutation when the target row is visible
 *     on a committed connection and belongs to another tenant.
 *  2. POST-verify the actually-affected row returned by `query(args)`: rows
 *     created EARLIER IN THE SAME interactive transaction are invisible to the
 *     raw client (different connection), so the pre-check cannot see them.
 *     The executed write's result IS visible on the same connection, so this
 *     second check closes that gap. Inside an interactive transaction a throw
 *     rolls the whole transaction back, so no unauthorized write persists.
 *
 * `Prisma.getExtensionContext(this)` is NOT used: in Prisma's $allOperations
 * hooks `this` is an internal array, and the unwrapped context exposes neither
 * model delegates nor raw methods (both confirmed during real-DB verification).
 */
export function createTenantScopeExtension(tenant: TenantContextService, raw?: PrismaClient) {
  return Prisma.defineExtension({
    name: 'thulir-tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }: any) {
          if (!TENANT_MODELS.has(model)) {
            return query(args);
          }

          const orgId = tenant.getOrganizationId();
          if (!orgId) {
            throw new TenantContextError(
              `Tenant-scoped model "${model}" was queried (${operation}) with no tenant context in scope. ` +
                'Wrap the call in TenantContextService.run(organizationId, ...) or route it through the TenantMiddleware.',
            );
          }

          switch (operation) {
            case 'findMany':
            case 'findFirst':
            case 'findFirstOrThrow':
            case 'count':
            case 'aggregate':
            case 'groupBy':
              args.where = applyTenantWhere(args.where, orgId);
              return query(args);

            case 'findUnique':
            case 'findUniqueOrThrow': {
              const row = await query(args);
              if (row) {
                assertRowOwnedByTenant(row, orgId, model);
              }
              return row;
            }

            case 'create': {
              assertDataOwnedByTenant(args.data, orgId, model);
              if (args.data && typeof args.data === 'object' && args.data.organizationId === undefined) {
                args.data.organizationId = orgId;
              }
              return query(args);
            }

            case 'createMany': {
              const rows = Array.isArray(args.data) ? args.data : [args.data];
              for (const row of rows) {
                assertDataOwnedByTenant(row, orgId, model);
                if (row && typeof row === 'object' && row.organizationId === undefined) {
                  row.organizationId = orgId;
                }
              }
              return query(args);
            }

            case 'update':
            case 'delete': {
              const id = args.where?.id;
              if (!id) {
                throw new TenantContextError(`Cannot tenant-verify ${model}.${operation} without a scalar id in where`);
              }
              const owner = await fetchOwnerId(raw, model, id);
              if (owner && owner !== orgId) {
                throw new TenantContextError(`Cannot ${operation} ${model} row ${String(id)}: it does not belong to tenant ${orgId}`);
              }
              const row = await query(args);
              if (row) {
                assertRowOwnedByTenant(row, orgId, model);
              }
              return row;
            }

            case 'upsert': {
              const id = args.where?.id;
              if (!id) {
                throw new TenantContextError(`Cannot tenant-verify ${model}.upsert without a scalar id in where`);
              }
              const owner = await fetchOwnerId(raw, model, id);
              if (owner && owner !== orgId) {
                throw new TenantContextError(`Cannot upsert ${model} row ${String(id)}: it does not belong to tenant ${orgId}`);
              }
              assertDataOwnedByTenant(args.create, orgId, model);
              if (args.create && typeof args.create === 'object' && args.create.organizationId === undefined) {
                args.create.organizationId = orgId;
              }
              const row = await query(args);
              if (row) {
                assertRowOwnedByTenant(row, orgId, model);
              }
              return row;
            }

            case 'updateMany':
            case 'deleteMany':
              args.where = applyTenantWhere(args.where, orgId);
              return query(args);

            default:
              return query(args);
          }
        },
      },
    },
  });
}

/**
 * Pre-check: reads the owning organizationId of a row by id on the plain
 * client. `raw` is optional so the extension remains usable standalone (e.g.
 * in the unit spec) — without it the pre-check is skipped and enforcement
 * falls back entirely to the post-verify of the affected row.
 */
async function fetchOwnerId(raw: PrismaClient | undefined, model: string, id: string): Promise<string | null> {
  if (!raw) {
    return null;
  }
  const delegate = (raw as any)[model] as { findUnique: (args: unknown) => Promise<{ organizationId: string } | null> };
  const row = await delegate.findUnique({ where: { id }, select: { organizationId: true } });
  return row?.organizationId ?? null;
}
