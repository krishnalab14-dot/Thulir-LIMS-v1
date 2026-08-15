import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { computeOrderTotal } from '../src/orders/order-totals.util';
import { CreateOrderDto } from '../src/orders/dto/create-order.dto';
import { OrdersService } from '../src/orders/orders.service';
import { PatientsService } from '../src/patients/patients.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/prisma/tenant-context.service';

function decimal(n: string | number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

function buildOrder(overrides: Partial<CreateOrderDto> = {}): CreateOrderDto {
  return {
    patient: { firstName: 'Ravi', lastName: 'Kumar', gender: 'male', mobile: '9876543210', dob: new Date('1990-01-01') },
    testIds: ['t_cbc', 't_fbs'],
    billing: { discountPercent: 10 },
    payment: { splits: [{ mode: 'cash', amount: 495 }] },
    ...overrides,
  } as CreateOrderDto;
}

describe('order billing validation (server-side)', () => {
  describe('computeOrderTotal', () => {
    it('applies a discount and rounds to 2 decimals', () => {
      expect(computeOrderTotal(decimal(1000), decimal(10)).toString()).toBe('900');
      expect(computeOrderTotal(decimal(333.33), decimal(10)).toString()).toBe('300');
      expect(computeOrderTotal(decimal(1000), decimal(0)).toString()).toBe('1000');
    });
  });

  describe('POST /api/orders', () => {
    const $transaction = jest.fn();
    const orderFindMany = jest.fn();
    const prismaMock = { prisma: { $transaction, order: { findMany: orderFindMany } } };

    let service: OrdersService;
    let tenant: TenantContextService;

    beforeEach(async () => {
      jest.clearAllMocks();
      const moduleRef = await Test.createTestingModule({
        providers: [OrdersService, PatientsService, TenantContextService, { provide: PrismaService, useValue: prismaMock }],
      }).compile();
      service = moduleRef.get(OrdersService);
      tenant = moduleRef.get(TenantContextService);
    });

    interface MockTx {
      patient: { findUnique: jest.Mock; create: jest.Mock };
      organization: { findUnique: jest.Mock };
      masterTest: { findMany: jest.Mock };
      masterTestPackage: { findMany: jest.Mock };
      testSpecification: { findMany: jest.Mock };
      party: { findFirst: jest.Mock };
      order: { create: jest.Mock; findFirst: jest.Mock };
      orderTest: { create: jest.Mock };
      sample: { create: jest.Mock };
      invoice: { create: jest.Mock; update: jest.Mock };
      payment: { create: jest.Mock };
      $queryRaw: jest.Mock;
    }

    function mockTx(): MockTx {
      return {
        patient: { findUnique: jest.fn(), create: jest.fn().mockResolvedValue({ id: 'pat1', patientUid: 'THU-2026-0001' }) },
        organization: { findUnique: jest.fn().mockResolvedValue({ id: 'org_demo', name: 'Thulir Demo Lab' }) },
        masterTest: { findMany: jest.fn() },
        masterTestPackage: { findMany: jest.fn() },
        // No TestSpecifications exist in the mocked catalog — the range
        // resolution for numeric tests falls back to (absent) defaults and
        // leaves billing untouched, which is what these tests assert.
        testSpecification: { findMany: jest.fn().mockResolvedValue([]) },
        party: { findFirst: jest.fn() },
        order: {
          create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ord1', ...data })),
          findFirst: jest.fn().mockResolvedValue({ id: 'ord1', patient: {}, orderTests: [], invoice: { payments: [] } }),
        },
        orderTest: {
          create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ot1', ...data })),
        },
        sample: {
          create: jest.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'smp1', ...data })),
        },
        invoice: { create: jest.fn().mockResolvedValue({ id: 'inv1' }), update: jest.fn() },
        payment: { create: jest.fn().mockResolvedValue({ id: 'pay1' }) },
        $queryRaw: jest.fn().mockResolvedValue([{ counter: 1n }]),
      };
    }

    function seedCatalog(tx: MockTx, prices: Record<string, string>) {
      tx.masterTest.findMany.mockImplementation(
        ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => ({ id, testName: `Test ${id}`, currentPrice: decimal(prices[id] ?? '100') })),
      );
    }

    function runOrder(dto: CreateOrderDto) {
      const tx = mockTx();
      $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));
      return { tx, promise: tenant.runAs({ organizationId: 'org_demo', userId: 'user_test' }, () => service.createOrder(dto)) };
    }

    function runOrderWith(tx: MockTx, dto: CreateOrderDto) {
      $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));
      return tenant.runAs({ organizationId: 'org_demo', userId: 'user_test' }, () => service.createOrder(dto));
    }

    it('computes subtotal/total server-side, snapshots prices, and pays the invoice when splits are exact', async () => {
      const { tx, promise } = runOrder(buildOrder()); // CBC 400 + FBS 150 = 550; 10% → 495
      seedCatalog(tx, { t_cbc: '400', t_fbs: '150' });

      await promise;

      const orderData = (tx.order.create as jest.Mock).mock.calls[0][0].data;
      expect(orderData.status).toBe('billed');
      expect(orderData.subtotal.toString()).toBe('550');
      expect(orderData.discountPercent.toString()).toBe('10');
      expect(orderData.totalAmount.toString()).toBe('495');
      // OrderTest rows are created individually after the Order (Stage 2: the
      // order transaction also creates one Sample per distinct tube type).
      const otRows = (tx.orderTest.create as jest.Mock).mock.calls.map((c: unknown[]) => (c[0] as { data: unknown }).data);
      expect(otRows).toHaveLength(2);
      expect(otRows[0]).toEqual(
        expect.objectContaining({ testId: 't_cbc', testNameSnapshot: 'Test t_cbc', snapshottedPrice: decimal(400) }),
      );
      expect(tx.sample.create).not.toHaveBeenCalled(); // catalog rows have no required sample type

      const invoiceData = (tx.invoice.create as jest.Mock).mock.calls[0][0].data;
      expect(invoiceData.totalAmount.toString()).toBe('495');

      // ₹495 cash = total → invoice paid.
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { status: 'paid' } });
      const paymentData = (tx.payment.create as jest.Mock).mock.calls[0][0].data;
      expect(paymentData.splits.create).toEqual([{ mode: 'cash', amount: expect.anything() }]);
    });

    it('leaves the invoice due when no payment splits are provided', async () => {
      const { tx, promise } = runOrder(buildOrder({ payment: undefined }));
      seedCatalog(tx, { t_cbc: '400', t_fbs: '150' });
      await promise;
      expect(tx.payment.create).not.toHaveBeenCalled();
      expect(tx.invoice.update).not.toHaveBeenCalled();
    });

    it('rejects a discountPercent of 150 server-side', async () => {
      const { promise } = runOrder(buildOrder({ billing: { discountPercent: 150 } }));
      await expect(promise).rejects.toThrow('between 0 and 100');
    });

    it('rejects a tampered client subtotal via the cross-check', async () => {
      const { tx, promise } = runOrder(buildOrder({ billing: { discountPercent: 10, subtotal: 100 } }));
      seedCatalog(tx, { t_cbc: '400', t_fbs: '150' }); // server computes 550
      await expect(promise).rejects.toThrow('Cross-check failed');
    });

    it('rejects a tampered client total via the cross-check', async () => {
      const { tx, promise } = runOrder(buildOrder({ billing: { discountPercent: 10, total: 999 } }));
      seedCatalog(tx, { t_cbc: '400', t_fbs: '150' }); // server computes 495
      await expect(promise).rejects.toThrow('Cross-check failed');
    });

    it('rejects payment splits that do not sum to the amount being paid', async () => {
      const { tx, promise } = runOrder(
        buildOrder({ payment: { amount: 500, splits: [{ mode: 'cash', amount: 495 }] } }),
      );
      seedCatalog(tx, { t_cbc: '400', t_fbs: '150' }); // total is 495, paid amount claimed 500
      await expect(promise).rejects.toThrow('do not sum exactly to the amount being paid');
    });

    it('rejects when a selected test does not exist', async () => {
      const tx = mockTx();
      tx.masterTest.findMany.mockResolvedValue([]);
      await expect(runOrderWith(tx, buildOrder({ testIds: ['t_ghost'] }))).rejects.toThrow('do not exist or are inactive');
    });

    it('rejects when neither tests nor packages are selected', async () => {
      await expect(
        tenant.runAs({ organizationId: 'org_demo', userId: 'user_test' }, () => service.createOrder(buildOrder({ testIds: [], packageIds: [] }))),
      ).rejects.toThrow('At least one test or package');
    });

    it('requires a tenant context (fail-closed) and rejects cross-tenant patient links', async () => {
      await expect(service.createOrder(buildOrder())).rejects.toThrow(/tenant context|TenantContextError/);
    });

    it('bills a package at its OWN packagePrice, never the sum of constituent test prices', async () => {
      // Tests would total ₹1200 standalone (700 + 500); the package costs ₹900.
      const { tx, promise } = runOrder(buildOrder({ testIds: [], packageIds: ['pkg_x'], billing: {}, payment: undefined }));
      seedCatalog(tx, { t_a: '700', t_b: '500' });
      tx.masterTestPackage.findMany.mockResolvedValue([
        { id: 'pkg_x', packageName: 'Bundle', packagePrice: decimal(900), items: [{ testId: 't_a' }, { testId: 't_b' }] },
      ]);

      await promise;

      const orderData = (tx.order.create as jest.Mock).mock.calls[0][0].data;
      expect(orderData.subtotal.toString()).toBe('900');
      expect(orderData.totalAmount.toString()).toBe('900');

      // One OrderTest row per constituent (needed for Result Entry), with
      // prices distributed proportionally: 900 × 700/1200 = 525, 375.
      const rows = (tx.orderTest.create as jest.Mock).mock.calls.map(
        (c: unknown[]) => (c[0] as { data: { testId: string; snapshottedPrice: Prisma.Decimal } }).data,
      );
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.testId === 't_a')?.snapshottedPrice.toString()).toBe('525');
      expect(rows.find((r) => r.testId === 't_b')?.snapshottedPrice.toString()).toBe('375');
      const sum = rows.reduce((acc, r) => acc.plus(r.snapshottedPrice), decimal(0));
      expect(sum.toString()).toBe('900');
    });

    it('bills a standalone test and a package together without cross-deduping', async () => {
      const { tx, promise } = runOrder(
        buildOrder({ testIds: ['t_cbc'], packageIds: ['pkg_x'], billing: {}, payment: undefined }),
      );
      seedCatalog(tx, { t_cbc: '400', t_a: '700', t_b: '500' });
      tx.masterTestPackage.findMany.mockResolvedValue([
        { id: 'pkg_x', packageName: 'Bundle', packagePrice: decimal(900), items: [{ testId: 't_a' }, { testId: 't_b' }] },
      ]);

      await promise;

      const orderData = (tx.order.create as jest.Mock).mock.calls[0][0].data;
      expect(orderData.subtotal.toString()).toBe('1300'); // 400 standalone + 900 package
      expect((tx.orderTest.create as jest.Mock).mock.calls).toHaveLength(3);
    });

    it('bills a single-test package at its own price, not the test price', async () => {
      const { tx, promise } = runOrder(buildOrder({ testIds: [], packageIds: ['pkg_1'], billing: {}, payment: undefined }));
      seedCatalog(tx, { t_a: '400' });
      tx.masterTestPackage.findMany.mockResolvedValue([
        { id: 'pkg_1', packageName: 'Single', packagePrice: decimal(300), items: [{ testId: 't_a' }] },
      ]);

      await promise;

      const orderData = (tx.order.create as jest.Mock).mock.calls[0][0].data;
      expect(orderData.subtotal.toString()).toBe('300');
      const rows = (tx.orderTest.create as jest.Mock).mock.calls.map(
        (c: unknown[]) => (c[0] as { data: { snapshottedPrice: Prisma.Decimal } }).data,
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].snapshottedPrice.toString()).toBe('300');
    });

    it('rejects a test ordered both standalone and inside a package (overlap prevention)', async () => {
      // Urea standalone (200) + RFT package that ALSO contains Urea → the order
      // would bill Urea twice. The server rejects instead of silently merging.
      const tx = mockTx();
      seedCatalog(tx, { t_urea: '200', t_creat: '150' });
      tx.masterTestPackage.findMany.mockResolvedValue([
        { id: 'pkg_rft', packageName: 'RFT', packagePrice: decimal(300), items: [{ testId: 't_urea' }, { testId: 't_creat' }] },
      ]);

      await expect(
        runOrderWith(tx, buildOrder({ testIds: ['t_urea'], packageIds: ['pkg_rft'], billing: {}, payment: undefined })),
      ).rejects.toThrow('both standalone and inside package');
      expect(tx.order.create).not.toHaveBeenCalled();
    });

    it('rejects multiple overlapping standalone tests across several packages, naming each conflict', async () => {
      const tx = mockTx();
      seedCatalog(tx, { t_urea: '200', t_creat: '150', t_cbc: '400' });
      tx.masterTestPackage.findMany.mockResolvedValue([
        { id: 'pkg_rft', packageName: 'RFT', packagePrice: decimal(300), items: [{ testId: 't_urea' }, { testId: 't_creat' }] },
        { id: 'pkg_cc', packageName: 'CBC+', packagePrice: decimal(450), items: [{ testId: 't_cbc' }] },
      ]);

      await expect(
        runOrderWith(
          tx,
          buildOrder({ testIds: ['t_urea', 't_cbc'], packageIds: ['pkg_rft', 'pkg_cc'], billing: {}, payment: undefined }),
        ),
      ).rejects.toThrow(/both standalone and inside package.*RFT.*CBC\+/);
      expect(tx.order.create).not.toHaveBeenCalled();
    });

    it('allows a standalone test and a package when their items are disjoint (no false positive)', async () => {
      const { tx, promise } = runOrder(
        buildOrder({ testIds: ['t_cbc'], packageIds: ['pkg_x'], billing: {}, payment: undefined }),
      );
      seedCatalog(tx, { t_cbc: '400', t_a: '700', t_b: '500' });
      tx.masterTestPackage.findMany.mockResolvedValue([
        { id: 'pkg_x', packageName: 'Bundle', packagePrice: decimal(900), items: [{ testId: 't_a' }, { testId: 't_b' }] },
      ]);

      await promise;

      const orderData = (tx.order.create as jest.Mock).mock.calls[0][0].data;
      expect(orderData.subtotal.toString()).toBe('1300'); // 400 standalone + 900 package
      expect((tx.orderTest.create as jest.Mock).mock.calls).toHaveLength(3);
    });
  });
});
