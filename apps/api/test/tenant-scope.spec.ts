import { PrismaClient } from '@prisma/client';
import {
  applyTenantWhere,
  assertDataOwnedByTenant,
  assertRowOwnedByTenant,
  createTenantScopeExtension,
} from '../src/prisma/tenant-scope.extension';
import { TenantContextError, TenantContextService } from '../src/prisma/tenant-context.service';

/**
 * Fail-closed tenant scoping regression tests. A real PrismaClient (with the
 * extension applied) is used, but NO database is ever contacted: the fail-closed
 * throw happens before a query executes, and tenant-present reads fail only with
 * a connection error to an unroutable port — proving the guard passed.
 */
describe('tenant scoping (fail-closed)', () => {
  const tenant = new TenantContextService();
  const prisma = new PrismaClient({
    datasources: { db: { url: 'postgresql://user:pass@127.0.0.1:1/thulir_none' } },
  }).$extends(createTenantScopeExtension(tenant));

  describe('fail-closed reads', () => {
    it('throws TenantContextError when a tenant-scoped model is queried with no tenant context', async () => {
      await expect(prisma.patient.findMany()).rejects.toThrow(TenantContextError);
      await expect(prisma.order.findFirst()).rejects.toThrow(TenantContextError);
      await expect(prisma.masterTest.count()).rejects.toThrow(TenantContextError);
      await expect(prisma.invoice.findUnique({ where: { id: 'x' } })).rejects.toThrow(TenantContextError);
    });

    it('does NOT throw the tenant error once a tenant context is in scope (query proceeds to the DB layer)', async () => {
      const err = await tenant.run('org_demo', () =>
        prisma.patient
          .findMany()
          .then(() => null)
          .catch((e: unknown) => e),
      );
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TenantContextError);
    });

    it('leaves non-tenant models (Organization) untouched by the guard', async () => {
      const err = await prisma.organization
        .findUnique({ where: { id: 'org_demo' } })
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).not.toBeInstanceOf(TenantContextError);
    });
  });

  describe('pure injection helpers', () => {
    it('ANDs an organizationId filter into the caller where', () => {
      const where = applyTenantWhere({ mobile: '9876543210' }, 'org_demo');
      expect(where).toEqual({ AND: [{ mobile: '9876543210' }, { organizationId: 'org_demo' }] });
    });

    it('rejects write payloads claiming a different organization', () => {
      expect(() => assertDataOwnedByTenant({ organizationId: 'org_other' }, 'org_demo', 'Patient')).toThrow(
        TenantContextError,
      );
      expect(() => assertDataOwnedByTenant({ organizationId: 'org_demo' }, 'org_demo', 'Patient')).not.toThrow();
    });

    it('rejects fetched rows owned by another organization', () => {
      expect(() => assertRowOwnedByTenant({ id: 'p', organizationId: 'org_other' }, 'org_demo', 'Patient')).toThrow(
        TenantContextError,
      );
      expect(() => assertRowOwnedByTenant({ id: 'p', organizationId: 'org_demo' }, 'org_demo', 'Patient')).not.toThrow();
    });
  });

  describe('TenantContextService', () => {
    it('runs code inside a tenant context and restores it afterwards', () => {
      expect(tenant.getOrganizationId()).toBeUndefined();
      tenant.run('org_a', () => {
        expect(tenant.getOrganizationId()).toBe('org_a');
      });
      expect(tenant.getOrganizationId()).toBeUndefined();
    });

    it('requireOrganizationId throws outside a context and returns the id inside one', () => {
      expect(() => tenant.requireOrganizationId()).toThrow(TenantContextError);
      tenant.run('org_a', () => {
        expect(tenant.requireOrganizationId()).toBe('org_a');
      });
    });
  });
});
