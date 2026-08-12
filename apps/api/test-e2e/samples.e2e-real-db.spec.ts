import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SYSTEM_USER_ID } from '../src/common/constants';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextError, TenantContextService } from '../src/prisma/tenant-context.service';

/**
 * REAL-DATABASE Stage 2 (Sample Collection) suite — same bar as Stage 1.
 * Runs inside `npm run verify:real-db` against real Postgres, driving the
 * real Nest app over HTTP. Covers:
 *   - order creation auto-creating one Sample per distinct required sample type
 *   - the collection worklist
 *   - conditional-update collect (+ the double-collect concurrency race)
 *   - reject → auto-recollection + OrderTest re-link, billing untouched
 *   - recollection chain walking (3 levels) + label data
 *   - fail-closed tenant scoping on the Sample model
 */
const ORG = 'org_demo';

describe('Stage 2 real-DB verification — sample collection', () => {
  let app: INestApplication;
  let prismaService: PrismaService;
  let tenant: TenantContextService;
  const plain = new PrismaClient();

  // Catalog + order state shared across tests (executed in declaration order).
  let edtaSampleTypeId: string;
  let serumSampleTypeId: string;
  let tEdtaA: string;
  let tEdtaB: string;
  let tSerum: string;

  let order1Id: string;
  let order2Id: string;
  let sampleEdtaId: string; // order1, pending (collect tests)
  let sampleSerumId: string; // order1, pending (double-collect race)
  let sampleOrder2Id: string; // order2, pending (reject chain tests)
  let sampleOrder2RecollectionId: string; // -R2, created by the first reject

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    jest.setTimeout(120_000);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    prismaService = app.get(PrismaService);
    tenant = app.get(TenantContextService);

    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Sample", "Order", "Patient", "UidCounter" CASCADE`,
    );

    // Catalog: two sample types (codes derived from name: EDTA / SERU) and
    // three tests — two sharing the EDTA tube, one on the Serum tube.
    const st1 = await http().post('/api/masters/sample-types').set('x-organization-id', ORG).send({ name: 'EDTA Tube' });
    const st2 = await http().post('/api/masters/sample-types').set('x-organization-id', ORG).send({ name: 'Serum Tube' });
    expect(st1.status).toBe(201);
    expect(st2.status).toBe(201);
    edtaSampleTypeId = st1.body.id;
    serumSampleTypeId = st2.body.id;

    // Numeric tests carry default ranges — §2 rule 4 rejects ordering a
    // numeric test with NO range at all.
    const t1 = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({ testCode: 'S2-EDTA-A', testName: 'S2 EDTA Test A', currentPrice: 100, requiredSampleTypeId: edtaSampleTypeId, defaultRefLow: 1, defaultRefHigh: 100 });
    const t2 = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({ testCode: 'S2-EDTA-B', testName: 'S2 EDTA Test B', currentPrice: 150, requiredSampleTypeId: edtaSampleTypeId, defaultRefLow: 1, defaultRefHigh: 100 });
    const t3 = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({ testCode: 'S2-SER', testName: 'S2 Serum Test', currentPrice: 200, requiredSampleTypeId: serumSampleTypeId, defaultRefLow: 1, defaultRefHigh: 100 });
    expect([t1.status, t2.status, t3.status]).toEqual([201, 201, 201]);
    tEdtaA = t1.body.id;
    tEdtaB = t2.body.id;
    tSerum = t3.body.id;

    // Order 1: 2 EDTA tests + 1 Serum test → exactly 2 samples.
    const o1 = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Samp', lastName: 'Patient', gender: 'female', mobile: '9440000001', dob: '1992-02-02' },
        testIds: [tEdtaA, tEdtaB, tSerum],
        billing: {},
        payment: { splits: [{ mode: 'cash', amount: 450 }] },
      });
    expect(o1.status).toBe(201);
    order1Id = o1.body.id;

    // Order 2: single EDTA test → 1 sample (drives the reject/recollection chain).
    const o2 = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Rej', lastName: 'Patient', gender: 'male', mobile: '9440000002', dob: '1980-03-03' },
        testIds: [tEdtaA],
        billing: {},
      });
    expect(o2.status).toBe(201);
    order2Id = o2.body.id;
    const o2Samples = await plain.sample.findMany({ where: { orderId: order2Id } });
    expect(o2Samples).toHaveLength(1);
    sampleOrder2Id = o2Samples[0].id;
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  it('order creation auto-creates one pending Sample per distinct required sample type, barcodes deterministic + unique, OrderTests linked', async () => {
    const samples = await plain.sample.findMany({ where: { orderId: order1Id }, orderBy: { createdAt: 'asc' } });
    expect(samples).toHaveLength(2); // EDTA tube shared by 2 tests → ONE sample

    const edta = samples.find((s) => s.sampleTypeId === edtaSampleTypeId)!;
    const serum = samples.find((s) => s.sampleTypeId === serumSampleTypeId)!;
    expect(edta).toBeDefined();
    expect(serum).toBeDefined();

    const prefix = order1Id.toUpperCase();
    expect(edta.barcodeValue).toBe(`${prefix}-EDTA`);
    expect(serum.barcodeValue).toBe(`${prefix}-SERU`);
    expect(new Set(samples.map((s) => s.barcodeValue)).size).toBe(2); // unique

    expect(samples.every((s) => s.status === 'pending_collection')).toBe(true);
    expect(samples.every((s) => s.organizationId === ORG)).toBe(true);

    // OrderTest linkage: both EDTA tests → EDTA sample; serum test → serum sample.
    const tests = await plain.orderTest.findMany({ where: { orderId: order1Id } });
    expect(tests).toHaveLength(3);
    const edtaTests = tests.filter((t) => t.sampleId === edta.id).map((t) => t.testId).sort();
    expect(edtaTests).toEqual([tEdtaA, tEdtaB].sort());
    const serumTests = tests.filter((t) => t.sampleId === serum.id).map((t) => t.testId);
    expect(serumTests).toEqual([tSerum]);

    sampleEdtaId = edta.id;
    sampleSerumId = serum.id;
  });

  it('GET /api/samples/pending returns pending samples oldest-first with patient/order/urgency/sample-type info', async () => {
    const res = await http().get('/api/samples/pending').set('x-organization-id', ORG);
    expect(res.status).toBe(200);
    const pending = res.body as Array<{
      id: string;
      barcodeValue: string;
      createdAt: string;
      sampleType: { name: string };
      order: { id: string; isUrgent: boolean; patient: { firstName: string; lastName: string } };
    }>;
    // Order 1's two samples plus order 2's sample are all pending at this point.
    const order1Pending = pending.filter((s) => s.order.id === order1Id);
    expect(order1Pending).toHaveLength(2);
    expect(order1Pending[0].sampleType.name).toBe('EDTA Tube');
    expect(order1Pending[1].sampleType.name).toBe('Serum Tube');
    expect(order1Pending[0].createdAt <= order1Pending[1].createdAt).toBe(true); // oldest first
    expect(pending.some((s) => s.order.patient.firstName === 'Samp')).toBe(true);
    expect(pending.every((s) => typeof s.order.isUrgent === 'boolean')).toBe(true);
    expect(pending.every((s) => /^[A-Z0-9]+-.+$/.test(s.barcodeValue))).toBe(true);
  });

  it('PUT /api/samples/:id/collect marks the sample collected with actor + timestamp and removes it from the worklist', async () => {
    const before = new Date();
    const res = await http().put(`/api/samples/${sampleEdtaId}/collect`).set('x-organization-id', ORG);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('collected');
    expect(res.body.collectedBy).toBe(SYSTEM_USER_ID);
    expect(new Date(res.body.collectedAt).getTime()).toBeGreaterThanOrEqual(before.getTime());

    const pending = await http().get('/api/samples/pending').set('x-organization-id', ORG);
    expect(pending.body.some((s: { id: string }) => s.id === sampleEdtaId)).toBe(false);
  });

  it('concurrency: two simultaneous collect attempts on the same sample → exactly one 200, one 409', async () => {
    const [a, b] = await Promise.all([
      http().put(`/api/samples/${sampleSerumId}/collect`).set('x-organization-id', ORG),
      http().put(`/api/samples/${sampleSerumId}/collect`).set('x-organization-id', ORG),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    // Exactly one collect landed in the DB — no double processing.
    const sample = await plain.sample.findUnique({ where: { id: sampleSerumId } });
    expect(sample!.status).toBe('collected');
    expect(sample!.collectedBy).toBe(SYSTEM_USER_ID);
    expect(sample!.collectedAt).not.toBeNull();
    const collectedRows = await plain.sample.findMany({
      where: { id: sampleSerumId, collectedAt: { not: null } },
    });
    expect(collectedRows).toHaveLength(1);
  });

  it('collecting an already-collected sample returns 409', async () => {
    const res = await http().put(`/api/samples/${sampleEdtaId}/collect`).set('x-organization-id', ORG);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('already been collected or rejected');
  });

  it('rejecting with reason "other" but no note is rejected server-side (400)', async () => {
    const res = await http()
      .put(`/api/samples/${sampleOrder2Id}/reject`)
      .set('x-organization-id', ORG)
      .send({ reason: 'other' });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body.message)).toContain('note is required');

    // Nothing changed — sample still pending.
    const sample = await plain.sample.findUnique({ where: { id: sampleOrder2Id } });
    expect(sample!.status).toBe('pending_collection');
  });

  it('rejecting auto-creates a recollection (-R2) with a new barcode, re-links OrderTests, and never touches billing', async () => {
    const orderBefore = await plain.order.findUnique({
      where: { id: order2Id },
      include: { invoice: { include: { payments: true } } },
    });

    const res = await http()
      .put(`/api/samples/${sampleOrder2Id}/reject`)
      .set('x-organization-id', ORG)
      .send({ reason: 'other', note: 'torn label' });
    expect(res.status).toBe(200); // returns the new recollection sample
    const recollection = res.body;
    expect(recollection.status).toBe('pending_collection');
    expect(recollection.barcodeValue).toBe(`${order2Id.toUpperCase()}-EDTA-R2`);
    expect(recollection.recollectionOfSampleId).toBe(sampleOrder2Id);
    expect(recollection.orderId).toBe(order2Id);

    const rejected = await plain.sample.findUnique({ where: { id: sampleOrder2Id } });
    expect(rejected!.status).toBe('rejected');
    expect(rejected!.rejectedReason).toBe('other');
    expect(rejected!.rejectedReasonNote).toBe('torn label');
    expect(rejected!.rejectedBy).toBe(SYSTEM_USER_ID);
    expect(rejected!.rejectedAt).not.toBeNull();

    // OrderTest re-linked to the recollection.
    const linked = await plain.orderTest.findMany({ where: { orderId: order2Id } });
    expect(linked).toHaveLength(1);
    expect(linked[0].sampleId).toBe(recollection.id);

    // Billing completely untouched.
    const orderAfter = await plain.order.findUnique({
      where: { id: order2Id },
      include: { invoice: { include: { payments: true } } },
    });
    expect(orderAfter!.subtotal.toString()).toBe(orderBefore!.subtotal.toString());
    expect(orderAfter!.totalAmount.toString()).toBe(orderBefore!.totalAmount.toString());
    expect(orderAfter!.status).toBe(orderBefore!.status);
    expect(orderAfter!.invoice!.status).toBe(orderBefore!.invoice!.status);
    expect(orderAfter!.invoice!.payments.length).toBe(orderBefore!.invoice!.payments.length);

    sampleOrder2RecollectionId = recollection.id;
  });

  it('rejecting the recollection creates -R3 and the detail endpoint walks the full chain (3 levels)', async () => {
    const res = await http()
      .put(`/api/samples/${sampleOrder2RecollectionId}/reject`)
      .set('x-organization-id', ORG)
      .send({ reason: 'hemolyzed' });
    expect(res.status).toBe(200);
    const r3 = res.body;
    expect(r3.barcodeValue).toBe(`${order2Id.toUpperCase()}-EDTA-R3`);
    expect(r3.recollectionOfSampleId).toBe(sampleOrder2RecollectionId);

    // Chain from the ORIGINAL sample: original → R2 → R3.
    const detail = await http().get(`/api/samples/${sampleOrder2Id}`).set('x-organization-id', ORG);
    expect(detail.status).toBe(200);
    const chain = detail.body.chain as Array<{ id: string; barcodeValue: string; status: string }>;
    expect(chain.map((c) => c.barcodeValue)).toEqual([
      `${order2Id.toUpperCase()}-EDTA`,
      `${order2Id.toUpperCase()}-EDTA-R2`,
      `${order2Id.toUpperCase()}-EDTA-R3`,
    ]);
    expect(chain[0].status).toBe('rejected');
    expect(chain[2].status).toBe('pending_collection');

    // Same chain visible from a MIDDLE node (both-direction walk).
    const mid = await http().get(`/api/samples/${sampleOrder2RecollectionId}`).set('x-organization-id', ORG);
    expect(mid.status).toBe(200);
    expect((mid.body.chain as Array<{ barcodeValue: string }>).map((c) => c.barcodeValue)).toEqual(
      chain.map((c) => c.barcodeValue),
    );
  });

  it('GET /api/samples/:id/label returns the printable label data', async () => {
    const res = await http().get(`/api/samples/${sampleOrder2Id}/label`).set('x-organization-id', ORG);
    expect(res.status).toBe(200);
    expect(res.body.barcodeValue).toBe(`${order2Id.toUpperCase()}-EDTA`);
    expect(res.body.patientName).toBe('Rej Patient');
    expect(res.body.sampleTypeName).toBe('EDTA Tube');
    expect(res.body.orderId).toBe(order2Id);
    expect(res.body.labName).toBe('Thulir Demo Lab');
  });

  it('Sample is fail-closed under tenant scoping against the real connection', async () => {
    await expect(prismaService.prisma.sample.findMany()).rejects.toThrow(TenantContextError);

    await tenant.run(ORG, async () => {
      const samples = await prismaService.prisma.sample.findMany();
      expect(samples.length).toBeGreaterThan(0);
    });

    // Cross-tenant point read of an existing sample → ownership check throws.
    await expect(
      tenant.run('org_other', () => prismaService.prisma.sample.findUnique({ where: { id: sampleEdtaId } })),
    ).rejects.toThrow(TenantContextError);

    // Cross-tenant conditional update → orgId ANDed in, zero rows affected → 409 (safe, not a leak).
    const res = await http().put(`/api/samples/${sampleEdtaId}/collect`).set('x-organization-id', 'org_other');
    expect(res.status).toBe(409);
    const still = await plain.sample.findUnique({ where: { id: sampleEdtaId } });
    expect(still!.status).toBe('collected'); // unchanged by the cross-tenant attempt
  });

});
