import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SYSTEM_USER_ID } from '../src/common/constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextError, TenantContextService } from '../src/prisma/tenant-context.service';

/**
 * REAL-DATABASE integration suite (runs only against a live PostgreSQL).
 *
 * Boots the real Nest app (real PrismaService + tenant middleware + DTO
 * validation) and drives it over real HTTP with supertest. This is the
 * verification that unit tests with mocked Prisma cannot provide: the initial
 * migration, the UidCounter SQL, Decimal handling, and the fail-closed tenant
 * extension all behave differently against a real server.
 *
 * Run via:  DATABASE_URL=postgresql://thulir:thulir@127.0.0.1:5432/thulir_lims npm run test:integration
 * (or just `npm run verify:real-db`, which starts embedded Postgres first).
 *
 * Requires the seeded `org_demo` organization (see prisma/seed.ts).
 */
const ORG = 'org_demo';

describe('Stage 1 real-DB verification', () => {
  let app: INestApplication;
  let tenant: TenantContextService;
  let prismaService: PrismaService;
  const plain = new PrismaClient();

  let testAId: string;
  let testBId: string;
  let testCId: string;
  let pkgId: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    tenant = app.get(TenantContextService);
    prismaService = app.get(PrismaService);

    // Wipe transactional data (catalog + org come from the seed). Uses a plain
    // client so the truncate itself is not tenant-scoped.
    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Order", "Patient", "UidCounter" CASCADE`,
    );
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  it('registers a patient (POST /api/patients) and surfaces it in duplicate-check', async () => {
    const res = await http()
      .post('/api/patients')
      .set('x-organization-id', ORG)
      .send({ firstName: 'Anita', lastName: 'Desai', gender: 'female', mobile: '9000000001', dob: '1991-03-14' });
    expect(res.status).toBe(201);
    expect(res.body.patientUid).toMatch(/^THU-\d{4}-\d{4}$/);

    const dup = await http().get('/api/patients/check-duplicate?mobile=9000000001').set('x-organization-id', ORG);
    expect(dup.status).toBe(200);
    expect(dup.body.results.some((p: { id: string }) => p.id === res.body.id)).toBe(true);
  });

  it('creates priced tests and a package via the API', async () => {
    const a = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({ testCode: 'E2E-ALPHA', testName: 'E2E Alpha Panel', currentPrice: 700 });
    expect(a.status).toBe(201);
    const b = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({ testCode: 'E2E-BETA', testName: 'E2E Beta Panel', currentPrice: 500 });
    expect(b.status).toBe(201);
    // A third test NOT in the package — needed to combine a standalone test
    // with the package without overlapping (overlap is rejected server-side).
    const c = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({ testCode: 'E2E-GAMMA', testName: 'E2E Gamma Panel', currentPrice: 800 });
    expect(c.status).toBe(201);
    const pkg = await http()
      .post('/api/masters/packages')
      .set('x-organization-id', ORG)
      .send({ packageName: 'E2E Bundle', packagePrice: 900, testIds: [a.body.id, b.body.id] });
    expect(pkg.status).toBe(201);
    expect(pkg.body.packagePrice).toBe('900');

    testAId = a.body.id;
    testBId = b.body.id;
    testCId = c.body.id;
    pkgId = pkg.body.id;
  });

  it('POST /api/orders bills a package at ITS price + a disjoint standalone test, with a split payment landing in every table', async () => {
    const res = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Ramesh', lastName: 'Iyer', gender: 'male', mobile: '9000000002', dob: '1985-06-15' },
        orderDetails: { isUrgent: true, clinicalNotes: 'e2e verification' },
        testIds: [testCId], // standalone 800 (NOT in the package → no overlap)
        packageIds: [pkgId], // own price 900 (standalone sum would be 1200)
        billing: { discountPercent: 10 },
        payment: { splits: [{ mode: 'cash', amount: 900 }, { mode: 'upi', amount: 630 }] },
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('billed');
    expect(res.body.subtotal).toBe('1700'); // 800 + 900 (NOT 800 + 1200)
    expect(res.body.totalAmount).toBe('1530'); // 10% off
    expect(res.body.orderTests).toHaveLength(3);
    expect(res.body.invoice.status).toBe('paid');

    // --- Verify what actually landed in the real DB (plain client) ---
    const order = await plain.order.findUnique({
      where: { id: res.body.id },
      include: { orderTests: true, invoice: { include: { payments: { include: { splits: true } } } } },
    });
    expect(order).not.toBeNull();
    expect(order!.organizationId).toBe(ORG);
    expect(order!.status).toBe('billed');
    expect(order!.subtotal.toString()).toBe('1700');
    expect(order!.totalAmount.toString()).toBe('1530');
    expect(order!.createdBy).toBe(SYSTEM_USER_ID);

    // One OrderTest per constituent; package price distributed (525/375), standalone at 800.
    const snapshots = order!.orderTests.map((t) => t.snapshottedPrice.toString()).sort();
    expect(snapshots).toEqual(['375', '525', '800']);
    expect(order!.orderTests.map((t) => t.testId)).toContain(testBId); // package's second constituent row exists
    expect(order!.orderTests.every((t) => t.status === 'pending')).toBe(true);

    const invoice = order!.invoice!;
    expect(invoice.status).toBe('paid');
    expect(invoice.subtotal.toString()).toBe('1700');
    expect(invoice.totalAmount.toString()).toBe('1530');

    expect(invoice.payments).toHaveLength(1);
    const payment = invoice.payments[0];
    expect(payment.organizationId).toBe(ORG);
    expect(payment.collectedBy).toBe(SYSTEM_USER_ID);
    const splitRows = payment.splits.map((s) => `${s.mode}:${s.amount.toString()}`).sort();
    expect(splitRows).toEqual(['cash:900', 'upi:630']);
  });

  it('rejects a test ordered both standalone and inside a package (400, no order rows)', async () => {
    // testA is standalone AND a constituent of the E2E Bundle → would double-bill.
    const before = await plain.order.count();
    const res = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Overlap', lastName: 'Case', gender: 'male', mobile: '9000000007', dob: '1978-04-04' },
        testIds: [testAId],
        packageIds: [pkgId],
        billing: {},
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('both standalone and inside package');
    const after = await plain.order.count();
    expect(after).toBe(before); // nothing persisted
  });

  it('rejects discountPercent 150 server-side (400)', async () => {
    const res = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Bad', lastName: 'Discount', gender: 'male', mobile: '9000000004', dob: '1975-01-01' },
        testIds: [testAId],
        billing: { discountPercent: 150 },
      });
    expect(res.status).toBe(400);
  });

  it('rejects a tampered client subtotal via the cross-check (400)', async () => {
    const res = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Tamper', lastName: 'Subtotal', gender: 'male', mobile: '9000000005', dob: '1976-02-02' },
        testIds: [testAId],
        billing: { subtotal: 100 }, // server computes 700
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('Cross-check failed');
  });

  it('rejects payment splits that do not sum to the amount being paid (400)', async () => {
    const res = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Bad', lastName: 'Splits', gender: 'male', mobile: '9000000006', dob: '1977-03-03' },
        testIds: [testAId],
        billing: {},
        payment: { amount: 1000, splits: [{ mode: 'cash', amount: 700 }] },
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('do not sum exactly');
  });

  it('records an additional payment via POST /api/invoices/:id/payments (due → partial)', async () => {
    const orderRes = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Kavya', lastName: 'Nair', gender: 'female', mobile: '9000000003', dob: '1990-04-04' },
        testIds: [testAId],
        billing: {},
      });
    expect(orderRes.status).toBe(201);
    expect(orderRes.body.invoice.status).toBe('due');
    const invoiceId = orderRes.body.invoice.id as string;

    const payRes = await http()
      .post(`/api/invoices/${invoiceId}/payments`)
      .set('x-organization-id', ORG)
      .send({ amount: 350, splits: [{ mode: 'cash', amount: 350 }] });
    expect(payRes.status).toBe(201);
    expect(payRes.body.status).toBe('partial');

    const invoice = await plain.invoice.findUnique({ where: { id: invoiceId } });
    expect(invoice!.status).toBe('partial');
  });

  it('tenant scoping is fail-closed against the real DB connection', async () => {
    // No tenant context → throws before any SQL is issued.
    await expect(prismaService.prisma.order.findMany()).rejects.toThrow(TenantContextError);

    // With a tenant context → the same query runs against the real DB.
    await tenant.run(ORG, async () => {
      const orders = await prismaService.prisma.order.findMany();
      expect(orders.length).toBeGreaterThan(0);
    });

    const someOrder = await plain.order.findFirst({ select: { id: true } });
    expect(someOrder).not.toBeNull();

    // Cross-tenant point read → post-fetch ownership check throws.
    await expect(
      tenant.run('org_other', () => prismaService.prisma.order.findUnique({ where: { id: someOrder!.id } })),
    ).rejects.toThrow(TenantContextError);

    // Cross-tenant write claiming a different org → throws.
    await expect(
      tenant.run('org_other', () =>
        prismaService.prisma.patient.create({
          data: {
            organizationId: ORG,
            patientUid: 'X-1',
            firstName: 'X',
            lastName: 'Y',
            gender: 'male',
            mobile: '0000000000',
            createdBy: SYSTEM_USER_ID,
          },
        }),
      ),
    ).rejects.toThrow(TenantContextError);

    // Cross-tenant update by id → ownership check throws before updating.
    await expect(
      tenant.run('org_other', () =>
        prismaService.prisma.order.update({ where: { id: someOrder!.id }, data: { clinicalNotes: 'hacked' } }),
      ),
    ).rejects.toThrow(TenantContextError);
  });
});
