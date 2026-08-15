import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { bearer, loginAdmin } from './test-helpers';

/**
 * REAL-DATABASE Stage 2.1 (dedicated-sample override) suite — same bar as the
 * rest of the real-DB verification. Runs inside `npm run verify:real-db`
 * against real Postgres over the real Nest HTTP stack. Covers the grouping
 * rule added by the follow-up:
 *
 *   - requiresDedicatedSample = false (default) ⇒ shares one Sample per
 *     distinct sample type, exactly as Stage 2 shipped (scenario 1 — two
 *     shared tests of the same type → 1 Sample — is asserted by the existing
 *     samples spec, which must stay green unmodified).
 *   - scenario 2: one shared + one dedicated test of the same type → exactly
 *     2 Samples (one shared, one dedicated), correct OrderTest.sampleId links,
 *     distinct barcodes.
 *   - scenario 3: one shared + two dedicated tests of the same type → exactly
 *     3 Samples (1 shared + 2 individually dedicated), no accidental grouping
 *     of the two dedicated tests with each other.
 *   - dedicated barcode format + recollection (-R2) of a dedicated sample.
 */
describe('Stage 2.1 real-DB verification — dedicated sample override', () => {
  let app: INestApplication;
  const plain = new PrismaClient();
  let authHeaders: Record<string, string>;

  let edtaTypeId: string;

  let tSharedA: string; // EDTA, requiresDedicatedSample = false
  let tDedicatedB: string; // EDTA, requiresDedicatedSample = true
  let tSharedC: string; // EDTA, requiresDedicatedSample = false
  let tDedicatedD: string; // EDTA, requiresDedicatedSample = true
  let tDedicatedE: string; // EDTA, requiresDedicatedSample = true

  let order1Id: string; // [tSharedA, tDedicatedB] → 2 samples
  let order2Id: string; // [tSharedC, tDedicatedD, tDedicatedE] → 3 samples

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    jest.setTimeout(120_000);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    const admin = await loginAdmin(app);
    authHeaders = bearer(admin.accessToken);

    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Sample", "Order", "Patient", "UidCounter" CASCADE`,
    );

    // One EDTA-type tube shared by all five tests below.
    const st = await http().post('/api/masters/sample-types').set(authHeaders).send({ name: 'EDTA Tube' });
    expect(st.status).toBe(201);
    edtaTypeId = st.body.id;

    const mk = async (testCode: string, testName: string, price: number, dedicated: boolean) => {
      const res = await http()
        .post('/api/masters/tests')
        .set(authHeaders)
        .send({
          testCode,
          testName,
          currentPrice: price,
          requiredSampleTypeId: edtaTypeId,
          requiresDedicatedSample: dedicated,
          // Numeric default range — §2 rule 4 rejects ordering a numeric test with NO range.
          defaultRefLow: 1,
          defaultRefHigh: 100,
        });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    tSharedA = await mk('D2-A', 'D2 Shared A', 100, false);
    tDedicatedB = await mk('D2-B', 'D2 Dedicated B', 150, true);
    tSharedC = await mk('D2-C', 'D2 Shared C', 120, false);
    tDedicatedD = await mk('D2-D', 'D2 Dedicated D', 200, true);
    tDedicatedE = await mk('D2-E', 'D2 Dedicated E', 250, true);

    // The flag persisted through the API (the new Masters DTO field).
    const rows = await plain.masterTest.findMany({
      where: { id: { in: [tSharedA, tDedicatedB, tSharedC, tDedicatedD, tDedicatedE] } },
    });
    const flagById = new Map(rows.map((r) => [r.id, r.requiresDedicatedSample]));
    expect(flagById.get(tSharedA)).toBe(false); // default false preserved
    expect(flagById.get(tDedicatedB)).toBe(true);
    expect(flagById.get(tSharedC)).toBe(false);
    expect(flagById.get(tDedicatedD)).toBe(true);
    expect(flagById.get(tDedicatedE)).toBe(true);

    const mkOrder = async (testIds: string[], mobile: string) => {
      const res = await http()
        .post('/api/orders')
        .set(authHeaders)
        .send({
          patient: { firstName: 'Ded', lastName: 'Sample', gender: 'female', mobile, dob: '1990-01-01' },
          testIds,
          billing: {},
        });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    order1Id = await mkOrder([tSharedA, tDedicatedB], '9330000001');
    order2Id = await mkOrder([tSharedC, tDedicatedD, tDedicatedE], '9330000002');
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  const samplesOf = async (orderId: string) =>
    plain.sample.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });

  const orderTestsOf = async (orderId: string) => plain.orderTest.findMany({ where: { orderId } });

  it('scenario 2: one shared + one dedicated test of the same type → exactly 2 Samples with correct links and distinct barcodes', async () => {
    const samples = await samplesOf(order1Id);
    expect(samples).toHaveLength(2);

    // Shared sample for the non-dedicated test only: <ORDER-ID>-EDTA.
    const sharedSample = samples.find((s) => s.barcodeValue === `${order1Id.toUpperCase()}-EDTA`);
    expect(sharedSample).toBeDefined();
    const dedicatedSample = samples.find(
      (s) => s.barcodeValue === `${order1Id.toUpperCase()}-EDTA-${tDedicatedB.toUpperCase()}`,
    );
    expect(dedicatedSample).toBeDefined();
    expect(new Set(samples.map((s) => s.barcodeValue)).size).toBe(2); // distinct

    const tests = await orderTestsOf(order1Id);
    const sharedTests = tests.filter((t) => t.sampleId === sharedSample!.id).map((t) => t.testId);
    expect(sharedTests).toEqual([tSharedA]);
    const dedicatedTests = tests.filter((t) => t.sampleId === dedicatedSample!.id).map((t) => t.testId);
    expect(dedicatedTests).toEqual([tDedicatedB]);

    expect(samples.every((s) => s.status === 'pending_collection')).toBe(true);
    expect(sharedSample!.status).toBe('pending_collection');
  });

  it('scenario 3: one shared + two dedicated tests of the same type → exactly 3 Samples (1 shared + 2 individual)', async () => {
    const samples = await samplesOf(order2Id);
    expect(samples).toHaveLength(3);

    const sharedSample = samples.find((s) => s.barcodeValue === `${order2Id.toUpperCase()}-EDTA`);
    expect(sharedSample).toBeDefined();
    const dSample = samples.find(
      (s) => s.barcodeValue === `${order2Id.toUpperCase()}-EDTA-${tDedicatedD.toUpperCase()}`,
    );
    expect(dSample).toBeDefined();
    const eSample = samples.find(
      (s) => s.barcodeValue === `${order2Id.toUpperCase()}-EDTA-${tDedicatedE.toUpperCase()}`,
    );
    expect(eSample).toBeDefined();

    // The two dedicated tests each got their OWN sample — never grouped together.
    expect(dSample!.id).not.toBe(eSample!.id);
    expect(new Set(samples.map((s) => s.barcodeValue)).size).toBe(3); // all distinct

    const tests = await orderTestsOf(order2Id);
    const sharedTests = tests.filter((t) => t.sampleId === sharedSample!.id).map((t) => t.testId);
    expect(sharedTests).toEqual([tSharedC]);
    const dTests = tests.filter((t) => t.sampleId === dSample!.id).map((t) => t.testId);
    expect(dTests).toEqual([tDedicatedD]);
    const eTests = tests.filter((t) => t.sampleId === eSample!.id).map((t) => t.testId);
    expect(eTests).toEqual([tDedicatedE]);

    // Every OrderTest is linked to exactly one sample.
    expect(tests).toHaveLength(3);
    expect(tests.every((t) => t.sampleId !== null)).toBe(true);
  });

  it('dedicated barcodes never collide with shared barcodes on the same order (format separation)', async () => {
    // A dedicated barcode is <ORDER>-<CODE>-<TESTID>; a shared one is
    // <ORDER>-<CODE>. Recollections of the shared tube append -R2, which must
    // not be confused with a dedicated test id.
    const order1Samples = await samplesOf(order1Id);
    const order2Samples = await samplesOf(order2Id);
    const all = [...order1Samples, ...order2Samples].map((s) => s.barcodeValue);
    expect(new Set(all).size).toBe(all.length);
  });

  it('rejecting a dedicated sample auto-creates its -R2 recollection, re-links only its OrderTest rows, and never touches billing', async () => {
    const orderBefore = await plain.order.findUnique({
      where: { id: order1Id },
      include: { invoice: { include: { payments: true } } },
    });

    const dedicated = (await samplesOf(order1Id)).find(
      (s) => s.barcodeValue === `${order1Id.toUpperCase()}-EDTA-${tDedicatedB.toUpperCase()}`,
    )!;

    const res = await http()
      .put(`/api/samples/${dedicated.id}/reject`)
      .set(authHeaders)
      .send({ reason: 'hemolyzed' });
    expect(res.status).toBe(200);
    const recollection = res.body;
    expect(recollection.barcodeValue).toBe(`${order1Id.toUpperCase()}-EDTA-${tDedicatedB.toUpperCase()}-R2`);
    expect(recollection.recollectionOfSampleId).toBe(dedicated.id);
    expect(recollection.orderId).toBe(order1Id);
    expect(recollection.status).toBe('pending_collection');

    // Only the dedicated test's OrderTest re-linked; the shared one keeps its
    // original shared sample.
    const tests = await orderTestsOf(order1Id);
    const reLinked = tests.filter((t) => t.sampleId === recollection.id).map((t) => t.testId);
    expect(reLinked).toEqual([tDedicatedB]);
    const sharedSample = (await samplesOf(order1Id)).find(
      (s) => s.barcodeValue === `${order1Id.toUpperCase()}-EDTA`,
    )!;
    const sharedTests = tests.filter((t) => t.sampleId === sharedSample.id).map((t) => t.testId);
    expect(sharedTests).toEqual([tSharedA]);

    // Billing completely untouched.
    const orderAfter = await plain.order.findUnique({
      where: { id: order1Id },
      include: { invoice: { include: { payments: true } } },
    });
    expect(orderAfter!.subtotal.toString()).toBe(orderBefore!.subtotal.toString());
    expect(orderAfter!.totalAmount.toString()).toBe(orderBefore!.totalAmount.toString());
    expect(orderAfter!.status).toBe(orderBefore!.status);
    expect(orderAfter!.invoice!.status).toBe(orderBefore!.invoice!.status);
    expect(orderAfter!.invoice!.payments.length).toBe(orderBefore!.invoice!.payments.length);
  });
});
