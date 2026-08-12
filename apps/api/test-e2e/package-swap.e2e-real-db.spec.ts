import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * REAL-DATABASE Stage 1 follow-up 2 (package-vs-package overlap) suite — same
 * bar as the rest of the real-DB verification. Runs inside
 * `npm run verify:real-db` against real Postgres over the real Nest HTTP stack.
 *
 * The gap being closed: two different packages containing the same test (RFT
 * and Kidney Panel both containing Creatinine) were previously allowed to both
 * be added, silently billing the shared test twice across two package-price
 * distributions. The required resolution is a straight SWAP, never a partial
 * merge — "Remove [Package A] & add [Package B]", with the server rejecting
 * any request that still arrives with both packages.
 *
 * The swap itself is a frontend state transition (the order is never created
 * with both packages), so this suite proves the backend half against the real
 * DB:
 *   1. the post-swap payload (only Package B) creates EXACTLY Package B's
 *      OrderTest rows and Samples — priced and grouped fresh (here including
 *      the dedicated/shared sample rules: Creatinine is dedicated, Glucose is
 *      shared), with no residue from Package A;
 *   2. the pre-swap order (only Package A) is completely untouched — its rows,
 *      samples and billing are intact, proving Cancel leaves order state alone;
 *   3. a direct both-packages request (bypassing the frontend) is rejected
 *      server-side with a clear error and nothing persisted.
 */
const ORG = 'org_demo';

describe('Stage 1 follow-up 2 real-DB verification — package-vs-package swap', () => {
  let app: INestApplication;
  const plain = new PrismaClient();

  let edtaTypeId: string;
  let serumTypeId: string;

  let tCreatId: string; // EDTA, requiresDedicatedSample = true
  let tUreaId: string; //  EDTA, requiresDedicatedSample = false
  let tGlucId: string; //  Serum, requiresDedicatedSample = false

  let rftPkgId: string; //    [Creat, Urea]  price 900
  let kidneyPkgId: string; // [Creat, Gluc]  price 700 — shares Creatinine with RFT

  let orderAId: string; // packageIds [rftPkgId]    — the pre-swap order
  let orderBId: string; // packageIds [kidneyPkgId] — the post-swap payload

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    jest.setTimeout(120_000);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    // Wipe transactional data so the swap assertions see exactly what THIS
    // suite created (same pattern as the samples spec).
    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Sample", "Order", "Patient", "UidCounter" CASCADE`,
    );

    const edta = await http().post('/api/masters/sample-types').set('x-organization-id', ORG).send({ name: 'EDTA Tube' });
    expect(edta.status).toBe(201);
    edtaTypeId = edta.body.id;
    const serum = await http().post('/api/masters/sample-types').set('x-organization-id', ORG).send({ name: 'Serum' });
    expect(serum.status).toBe(201);
    serumTypeId = serum.body.id;

    const mkTest = async (testCode: string, testName: string, price: number, sampleTypeId: string, dedicated: boolean) => {
      const res = await http()
        .post('/api/masters/tests')
        .set('x-organization-id', ORG)
        .send({ testCode, testName, currentPrice: price, requiredSampleTypeId: sampleTypeId, requiresDedicatedSample: dedicated });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    tCreatId = await mkTest('SWP-CREAT', 'Creatinine', 400, edtaTypeId, true);
    tUreaId = await mkTest('SWP-UREA', 'Urea', 200, edtaTypeId, false);
    tGlucId = await mkTest('SWP-GLUC', 'Glucose', 100, serumTypeId, false);

    const mkPkg = async (packageName: string, packagePrice: number, testIds: string[]) => {
      const res = await http()
        .post('/api/masters/packages')
        .set('x-organization-id', ORG)
        .send({ packageName, packagePrice, testIds });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    rftPkgId = await mkPkg('SWP RFT', 900, [tCreatId, tUreaId]);
    kidneyPkgId = await mkPkg('SWP Kidney Panel', 700, [tCreatId, tGlucId]);

    const mkOrder = async (packageIds: string[], mobile: string) => {
      const res = await http()
        .post('/api/orders')
        .set('x-organization-id', ORG)
        .send({ patient: { firstName: 'Swap', lastName: 'Case', gender: 'female', mobile, dob: '1992-02-02' }, packageIds, billing: {} });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    orderAId = await mkOrder([rftPkgId], '9440000001');
    orderBId = await mkOrder([kidneyPkgId], '9440000002');
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  const orderTestsOf = async (orderId: string) => plain.orderTest.findMany({ where: { orderId } });
  const samplesOf = async (orderId: string) => plain.sample.findMany({ where: { orderId }, orderBy: { createdAt: 'asc' } });

  it('post-swap payload: exactly the new package’s OrderTests + Samples, priced and grouped fresh (no residue from the old package)', async () => {
    const tests = await orderTestsOf(orderBId);
    expect(tests).toHaveLength(2);
    expect(tests.map((t) => t.testId).sort()).toEqual([tCreatId, tGlucId].sort()); // no Urea / RFT residue
    const priceByTest = new Map(tests.map((t) => [t.testId, t.snapshottedPrice.toString()]));
    // Kidney Panel bills at ITS own price (700) distributed proportionally:
    // Creatinine 700*400/500 = 560, Glucose 700*100/500 = 140 → sum exactly 700.
    expect(priceByTest.get(tCreatId)).toBe('560');
    expect(priceByTest.get(tGlucId)).toBe('140');

    // Samples grouped fresh per the Stage 2.1 rules: dedicated tube for
    // Creatinine, shared tube for Glucose.
    const samples = await samplesOf(orderBId);
    expect(samples).toHaveLength(2);
    const dedicated = samples.find((s) => s.barcodeValue === `${orderBId.toUpperCase()}-EDTA-${tCreatId.toUpperCase()}`);
    const shared = samples.find((s) => s.barcodeValue === `${orderBId.toUpperCase()}-SERU`);
    expect(dedicated).toBeDefined();
    expect(shared).toBeDefined();
    expect(dedicated!.status).toBe('pending_collection');
    expect(shared!.status).toBe('pending_collection');

    const creatTest = tests.find((t) => t.testId === tCreatId)!;
    const glucTest = tests.find((t) => t.testId === tGlucId)!;
    expect(creatTest.sampleId).toBe(dedicated!.id);
    expect(glucTest.sampleId).toBe(shared!.id);
  });

  it('pre-swap order (Package A only) is completely untouched — Cancel leaves order state alone', async () => {
    const tests = await orderTestsOf(orderAId);
    expect(tests).toHaveLength(2);
    expect(tests.map((t) => t.testId).sort()).toEqual([tCreatId, tUreaId].sort());
    const priceByTest = new Map(tests.map((t) => [t.testId, t.snapshottedPrice.toString()]));
    // RFT bills at its own price (900): Creatinine 900*400/600 = 600, Urea 300.
    expect(priceByTest.get(tCreatId)).toBe('600');
    expect(priceByTest.get(tUreaId)).toBe('300');

    const samples = await samplesOf(orderAId);
    expect(samples).toHaveLength(2);
    const dedicated = samples.find((s) => s.barcodeValue === `${orderAId.toUpperCase()}-EDTA-${tCreatId.toUpperCase()}`);
    const shared = samples.find((s) => s.barcodeValue === `${orderAId.toUpperCase()}-EDTA`);
    expect(dedicated).toBeDefined();
    expect(shared).toBeDefined();

    const order = await plain.order.findUnique({ where: { id: orderAId } });
    expect(order!.subtotal.toString()).toBe('900');
    expect(order!.totalAmount.toString()).toBe('900');
  });

  it('direct both-packages request (bypassing the frontend swap) is rejected server-side with a clear error, nothing persisted', async () => {
    const before = await plain.order.count();
    const res = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Bypass', lastName: 'Swap', gender: 'male', mobile: '9440000003', dob: '1980-06-06' },
        packageIds: [rftPkgId, kidneyPkgId], // SWP RFT + SWP Kidney Panel share Creatinine
        billing: {},
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain("both package 'SWP RFT' and package 'SWP Kidney Panel'");
    expect(res.body.message).toContain('Creatinine'); // names the shared test
    const after = await plain.order.count();
    expect(after).toBe(before); // nothing persisted — no partial order/sample rows
  });
});
