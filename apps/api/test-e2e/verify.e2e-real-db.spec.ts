import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, OrderTestStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SYSTEM_USER_ID } from '../src/common/constants';
import { TenantContextError, TenantContextService } from '../src/prisma/tenant-context.service';
import { VerifyService } from '../src/verify/verify.service';

/**
 * REAL-DATABASE Stage 4 (Verification) suite — same bar as every prior stage.
 * Runs inside `npm run verify:real-db` against real Postgres over the real
 * Nest HTTP stack. Covers every §6 done-criteria:
 *   - verify queue: only orders with ≥1 `entered` OrderTest, oldest-entered-
 *     first, patient/urgency/wait-time info;
 *   - review workspace: the FULL result sheet — every test regardless of
 *     status, same snapshot shape as the Stage 3 entry grid + verification
 *     metadata (never a parallel payload);
 *   - verify single row → status/actor/timestamp set, rollup advances;
 *   - Verify All Visible only touches `entered` rows, already-verified rows
 *     are reported skipped and untouched;
 *   - reject-back: note set, actor/timestamp cleared, resultValue INTACT,
 *     409 on a non-verified row (never a silent no-op);
 *   - CONCURRENCY: two simultaneous verify requests on the same entered row →
 *     exactly one lands, the other is reported skipped, one verifiedAt;
 *   - tenant fail-closed: no context throws; cross-tenant queue is empty and
 *     cross-tenant verify/reject attempts are safe no-ops.
 */
const ORG = 'org_demo';

describe('Stage 4 real-DB verification — verification', () => {
  let app: INestApplication;
  let verifyService: VerifyService;
  let tenant: TenantContextService;
  const plain = new PrismaClient();

  let tGlu: string; // V4 Glucose — serum, 70-99, critical 40-400, unit mg/dL
  let tHba: string; // V4 HbA1c — serum, 4-6, critical 3-8

  let orderAId: string; // [glu] — entered LAST (queue order) + reject-back target
  let orderBId: string; // [glu, hba] — entered SECOND; verify single + verify-all
  let orderCId: string; // [hba] — entered FIRST (oldest); concurrency target
  let orderDId: string; // [glu] — sample UNCOLLECTED, tests still pending (full-sheet proof)

  let otA: string;
  let otBGlu: string;
  let otBHba: string;
  let otC: string;
  let otD: string;

  const http = () => request(app.getHttpServer());
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    jest.setTimeout(120_000);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    verifyService = app.get(VerifyService);
    tenant = app.get(TenantContextService);

    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Sample", "Order", "Patient", "UidCounter" CASCADE`,
    );

    const stSerum = await http().post('/api/masters/sample-types').set('x-organization-id', ORG).send({ name: 'Serum Tube V4' });
    expect(stSerum.status).toBe(201);

    const glu = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({
        testCode: 'V4-GLU',
        testName: 'V4 Glucose',
        currentPrice: 150,
        requiredSampleTypeId: stSerum.body.id,
        defaultRefLow: 70,
        defaultRefHigh: 99,
        criticalLow: 40,
        criticalHigh: 400,
        unit: 'mg/dL',
      });
    const hba = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({
        testCode: 'V4-HBA',
        testName: 'V4 HbA1c',
        currentPrice: 300,
        requiredSampleTypeId: stSerum.body.id,
        defaultRefLow: 4,
        defaultRefHigh: 6,
        criticalLow: 3,
        criticalHigh: 8,
      });
    expect([glu.status, hba.status]).toEqual([201, 201]);
    tGlu = glu.body.id;
    tHba = hba.body.id;

    const mkOrder = async (name: string, mobile: string, dob: string, testIds: string[]) => {
      const res = await http()
        .post('/api/orders')
        .set('x-organization-id', ORG)
        .send({ patient: { firstName: name, lastName: 'Verify', gender: 'female', mobile, dob }, testIds, billing: {} });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    orderAId = await mkOrder('Alpha', '9440000001', '1985-01-01', [tGlu]);
    orderBId = await mkOrder('Beta', '9440000002', '1986-02-02', [tGlu, tHba]);
    orderCId = await mkOrder('Gamma', '9440000003', '1987-03-03', [tHba]);
    orderDId = await mkOrder('Delta', '9440000004', '1988-04-04', [tGlu]);

    otA = (await plain.orderTest.findFirst({ where: { orderId: orderAId } }))!.id;
    otBGlu = (await plain.orderTest.findFirst({ where: { orderId: orderBId, testId: tGlu } }))!.id;
    otBHba = (await plain.orderTest.findFirst({ where: { orderId: orderBId, testId: tHba } }))!.id;
    otC = (await plain.orderTest.findFirst({ where: { orderId: orderCId } }))!.id;
    otD = (await plain.orderTest.findFirst({ where: { orderId: orderDId } }))!.id;

    // Collect the samples of A, B, C (each has one shared serum sample). D
    // stays UNCOLLECTED — its test remains pending, proving the review sheet
    // shows every test regardless of status/sample state.
    for (const orderId of [orderAId, orderBId, orderCId]) {
      const sample = await plain.sample.findFirst({ where: { orderId } });
      await http().put(`/api/samples/${sample!.id}/collect`).set('x-organization-id', ORG).expect(200);
    }

    // Enter results OLDEST-FIRST for the queue ordering proof: C first, then
    // B (both), then A. 15ms gaps make the server-side enteredAt distinct.
    const enter = (orderId: string, entries: Array<{ orderTestId: string; resultValue: string }>) =>
      http().put(`/api/orders/${orderId}/results`).set('x-organization-id', ORG).send({ entries }).expect(200);

    await enter(orderCId, [{ orderTestId: otC, resultValue: '5.2' }]);
    await sleep(15);
    await enter(orderBId, [
      { orderTestId: otBGlu, resultValue: '92' },
      { orderTestId: otBHba, resultValue: '5.6' },
    ]);
    await sleep(15);
    await enter(orderAId, [{ orderTestId: otA, resultValue: '95' }]);
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  it('verify queue returns waiting orders oldest-entered-first with patient/wait/urgency info', async () => {
    const res = await http().get('/api/verify-queue').set('x-organization-id', ORG);
    expect(res.status).toBe(200);
    const queue = res.body as Array<{
      orderId: string;
      isUrgent: boolean;
      enteredCount: number;
      enteredAt: string | null;
      waitMs: number;
      patient: { patientUid: string; firstName: string; gender: string; ageYears: number };
    }>;

    // C entered first → oldest → first in the queue; A entered last → last.
    expect(queue.map((q) => q.orderId)).toEqual([orderCId, orderBId, orderAId]);
    expect(queue).not.toContainEqual(expect.objectContaining({ orderId: orderDId })); // no entered tests → absent

    const c = queue[0];
    expect(c.enteredCount).toBe(1);
    expect(c.waitMs).toBeGreaterThanOrEqual(0);
    expect(c.isUrgent).toBe(false);
    expect(c.patient.firstName).toBe('Gamma');
    expect(c.patient.patientUid).toMatch(/^THU-2026-\d{4}$/);
    expect(c.patient.gender).toBe('female');
    expect(c.patient.ageYears).toBeGreaterThan(30);

    const b = queue[1];
    expect(b.enteredCount).toBe(2); // both tests awaiting verification
    // enteredAt ordering is strictly ascending (oldest first).
    const times = queue.map((q) => new Date(q.enteredAt!).getTime());
    expect(times[0]).toBeLessThanOrEqual(times[1]);
    expect(times[1]).toBeLessThanOrEqual(times[2]);
  });

  it('review returns the FULL result sheet — every test regardless of status, same shape as the entry grid', async () => {
    const res = await http().get(`/api/orders/${orderBId}/review`).set('x-organization-id', ORG);
    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(orderBId);
    expect(res.body.patient.firstName).toBe('Beta');
    expect(res.body.patient.ageYears).toBeGreaterThan(30);

    const rows = res.body.samples.flatMap((s: { orderTests: unknown[] }) => s.orderTests) as Array<{
      id: string;
      testNameSnapshot: string;
      status: string;
      resultType: string;
      refLow: number | null;
      refHigh: number | null;
      unit: string | null;
      resultValue: string | null;
      verifiedBy: string | null;
      verifiedAt: string | null;
      verifyRejectedNote: string | null;
    }>;
    expect(rows).toHaveLength(2); // both tests, both entered
    const glu = rows.find((r) => r.id === otBGlu)!;
    const hba = rows.find((r) => r.id === otBHba)!;
    expect(glu.resultValue).toBe('92');
    expect(glu.refLow).toBe(70);
    expect(glu.refHigh).toBe(99);
    expect(glu.unit).toBe('mg/dL');
    expect(glu.status).toBe('entered');
    expect(glu.verifiedBy).toBeNull();
    expect(glu.verifiedAt).toBeNull();
    expect(glu.verifyRejectedNote).toBeNull();
    expect(hba.status).toBe('entered');
    expect(res.body.summary).toEqual({ total: 2, entered: 2, verified: 0 });
  });

  it('review includes pending tests whose sample is not collected (unlike the entry grid)', async () => {
    const res = await http().get(`/api/orders/${orderDId}/review`).set('x-organization-id', ORG);
    expect(res.status).toBe(200);
    const rows = res.body.samples.flatMap((s: { orderTests: unknown[] }) => s.orderTests) as Array<{
      id: string;
      status: string;
      resultValue: string | null;
      verifiedBy: string | null;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(otD);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].resultValue).toBeNull();
    expect(res.body.summary).toEqual({ total: 1, entered: 0, verified: 0 });
  });

  it('verifying a single row sets status/actor/timestamp and advances the rollup to partially_verified', async () => {
    const before = new Date();
    const res = await http()
      .put(`/api/orders/${orderBId}/verify`)
      .set('x-organization-id', ORG)
      .send({ orderTestIds: [otBGlu] });
    expect(res.status).toBe(200);
    expect(res.body.verified).toHaveLength(1);
    expect(res.body.verified[0]).toEqual(expect.objectContaining({ orderTestId: otBGlu, status: 'verified' }));
    expect(res.body.skipped).toHaveLength(0);
    // One entered + one verified → all at least entered, some not verified.
    expect(res.body.orderStatus).toBe('partially_verified');

    const row = await plain.orderTest.findUnique({ where: { id: otBGlu } });
    expect(row!.status).toBe(OrderTestStatus.verified);
    expect(row!.verifiedBy).toBe(SYSTEM_USER_ID);
    expect(row!.verifiedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row!.verifyRejectedNote).toBeNull();
    // The verify never touches the result value.
    expect(row!.resultValue).toBe('92');

    const order = await plain.order.findUnique({ where: { id: orderBId } });
    expect(order!.status).toBe('partially_verified');
  });

  it('Verify All Visible only touches entered rows; already-verified rows are reported skipped and untouched', async () => {
    // otBGlu is already verified; otBHba is still entered. One batch: the
    // entered row lands, the verified row is reported skipped (0 rows), and
    // its verifiedAt is NOT overwritten.
    const res = await http()
      .put(`/api/orders/${orderBId}/verify`)
      .set('x-organization-id', ORG)
      .send({ orderTestIds: [otBGlu, otBHba] });
    expect(res.status).toBe(200);
    expect(res.body.verified).toHaveLength(1);
    expect(res.body.verified[0].orderTestId).toBe(otBHba);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].orderTestId).toBe(otBGlu);
    expect(res.body.skipped[0].reason).toBe('stale');
    expect(res.body.orderStatus).toBe('partially_approved'); // all verified, none approved

    const glu = await plain.orderTest.findUnique({ where: { id: otBGlu } });
    const hba = await plain.orderTest.findUnique({ where: { id: otBHba } });
    expect(glu!.status).toBe(OrderTestStatus.verified);
    expect(hba!.status).toBe(OrderTestStatus.verified);
    expect(hba!.verifiedBy).toBe(SYSTEM_USER_ID);

    const order = await plain.order.findUnique({ where: { id: orderBId } });
    expect(order!.status).toBe('partially_approved');
  });

  it('reject-back: note recorded, actor/timestamp cleared, resultValue INTACT, 409 when not verified', async () => {
    // Order A is fully entered → verify it first through the API.
    const v = await http().put(`/api/orders/${orderAId}/verify`).set('x-organization-id', ORG).send({ orderTestIds: [otA] });
    expect(v.status).toBe(200);
    expect(v.body.verified).toHaveLength(1);

    const rejected = await http()
      .put(`/api/orders/${orderAId}/reject-back-to-entry`)
      .set('x-organization-id', ORG)
      .send({ orderTestId: otA, reason: 'Typing error in Sugar value' });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toEqual(
      expect.objectContaining({ orderTestId: otA, status: 'entered', verifyRejectedNote: 'Typing error in Sugar value' }),
    );
    // Rollup moved back down: the single test is entered again and none are
    // verified → partially_verified (all at least entered, some < verified).
    expect(rejected.body.orderStatus).toBe('partially_verified');

    const row = await plain.orderTest.findUnique({ where: { id: otA } });
    expect(row!.status).toBe(OrderTestStatus.entered);
    expect(row!.verifyRejectedNote).toBe('Typing error in Sugar value');
    expect(row!.verifiedBy).toBeNull();
    expect(row!.verifiedAt).toBeNull();
    expect(row!.resultValue).toBe('95'); // NEVER touched — the wrong value is corrected via Result Entry

    const order = await plain.order.findUnique({ where: { id: orderAId } });
    expect(order!.status).toBe('partially_verified');

    // Second reject-back on the now-entered row → 409, never a silent no-op.
    const again = await http()
      .put(`/api/orders/${orderAId}/reject-back-to-entry`)
      .set('x-organization-id', ORG)
      .send({ orderTestId: otA, reason: 'again' });
    expect(again.status).toBe(409);
    expect(again.body.message).toContain('V4 Glucose');
  });

  it('CONCURRENCY: two simultaneous verify requests on the same entered row → exactly one lands, one skipped', async () => {
    // otC (order C) is still entered — nothing has verified it yet.
    const [a, b] = await Promise.all([
      http().put(`/api/orders/${orderCId}/verify`).set('x-organization-id', ORG).send({ orderTestIds: [otC] }),
      http().put(`/api/orders/${orderCId}/verify`).set('x-organization-id', ORG).send({ orderTestIds: [otC] }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const landed = [a, b].filter((r) => r.body.verified.length === 1);
    const skipped = [a, b].filter((r) => r.body.skipped.length === 1);
    expect(landed).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].body.skipped[0].reason).toBe('stale');

    // Exactly ONE verified row with a single verifiedAt — no double write.
    const rows = await plain.orderTest.findMany({ where: { id: otC } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(OrderTestStatus.verified);
    expect(rows[0].verifiedAt).not.toBeNull();
  });

  it('validation: empty verify batch and missing reject reason are rejected (400)', async () => {
    const empty = await http().put(`/api/orders/${orderAId}/verify`).set('x-organization-id', ORG).send({ orderTestIds: [] });
    expect(empty.status).toBe(400);

    const noReason = await http()
      .put(`/api/orders/${orderBId}/reject-back-to-entry`)
      .set('x-organization-id', ORG)
      .send({ orderTestId: otBHba, reason: '' });
    expect(noReason.status).toBe(400);
  });

  it('verification is fail-closed under tenant scoping against the real connection', async () => {
    // No tenant context → throws before any SQL is issued.
    await expect(verifyService.getVerifyQueue()).rejects.toThrow(TenantContextError);

    // Cross-tenant queue → empty (the org filter is ANDed in, no leak).
    const otherQueue = await http().get('/api/verify-queue').set('x-organization-id', 'org_other');
    expect(otherQueue.status).toBe(200);
    expect(otherQueue.body).toEqual([]);

    // Cross-tenant review → the ownership post-check throws (fail-closed, no
    // data leak) — asserted at the service level, same pattern as the samples
    // suite's cross-tenant point-read assertion.
    await expect(tenant.run('org_other', () => verifyService.getReview(orderAId))).rejects.toThrow(TenantContextError);

    // Cross-tenant verify attempt on order A's ENTERED row → orgId ANDed in,
    // zero rows affected → reported skipped, row unchanged (safe, not a leak).
    const otherVerify = await http()
      .put(`/api/orders/${orderAId}/verify`)
      .set('x-organization-id', 'org_other')
      .send({ orderTestIds: [otA] });
    expect(otherVerify.status).toBe(200);
    expect(otherVerify.body.verified).toHaveLength(0);
    expect(otherVerify.body.skipped).toHaveLength(1);

    // Cross-tenant reject-back on order B's verified row → 409, row unchanged.
    const otherReject = await http()
      .put(`/api/orders/${orderBId}/reject-back-to-entry`)
      .set('x-organization-id', 'org_other')
      .send({ orderTestId: otBHba, reason: 'nope' });
    expect(otherReject.status).toBe(409);

    const aRow = await plain.orderTest.findUnique({ where: { id: otA } });
    expect(aRow!.status).toBe(OrderTestStatus.entered); // untouched by the cross-tenant verify
    const bRow = await plain.orderTest.findUnique({ where: { id: otBHba } });
    expect(bRow!.status).toBe(OrderTestStatus.verified); // untouched by the cross-tenant reject
  });
});
