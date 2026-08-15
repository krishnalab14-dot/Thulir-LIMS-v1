import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, OrderTestStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantContextError, TenantContextService } from '../src/prisma/tenant-context.service';
import { ApprovalService } from '../src/approval/approval.service';
import { bearer, loginAdmin, registerOrgAdmin } from './test-helpers';

/**
 * REAL-DATABASE Stage 5 (Approval) suite — same bar as every prior stage.
 * Runs inside `npm run verify:real-db` against real Postgres over the real
 * Nest HTTP stack. Covers every §6 done-criteria:
 *   - approval queue: only orders with ≥1 `verified` OrderTest,
 *     oldest-verified-first, patient/urgency/wait-time info;
 *   - approve-review: the FULL result sheet (same shared row shape as the
 *     entry grid / review sheet) PLUS the live-preview payload (lab
 *     letterhead name, signature ref, deterministic verification-code
 *     placeholder);
 *   - approve single row → status/actor/timestamp/signature-stamp set,
 *     rollup advances to approved;
 *   - Approve All Visible only touches `verified` rows — already-approved
 *     rows are reported skipped and untouched;
 *   - reject-back-to-verify → SAME `entered` state as Verify's reject-back
 *     (no fifth quasi-state), ALL verify/approve metadata cleared,
 *     resultValue INTACT, reason recorded, 409 on a non-verified/approved row;
 *   - CONCURRENCY: two simultaneous approve requests on the same verified
 *     row → exactly one lands, the other reported skipped, a single
 *     approvedAt/approvalSignatureStamp in the DB;
 *   - tenant fail-closed: no context throws; cross-tenant queue is empty and
 *     cross-tenant approve/reject attempts are safe no-ops.
 */
describe('Stage 5 real-DB verification — approval', () => {
  let app: INestApplication;
  let approvalService: ApprovalService;
  let tenant: TenantContextService;
  const plain = new PrismaClient();

  let authHeaders: Record<string, string>;
  let otherAuthHeaders: Record<string, string>;
  let adminUserId: string;

  let tGlu: string; // V5 Glucose — serum, 70-99, critical 40-400, unit mg/dL
  let tHba: string; // V5 HbA1c — serum, 4-6, critical 3-8

  let orderAId: string; // [glu] — entered/verified FIRST after C; single-approve target
  let orderBId: string; // [glu, hba] — approve-all + reject-back target
  let orderCId: string; // [hba] — concurrency target
  let orderDId: string; // [glu] — sample UNCOLLECTED, never enters/verifies
  let orderEId: string; // [glu] — verified LAST; stays verified for the cross-tenant queue proof

  let otA: string;
  let otBGlu: string;
  let otBHba: string;
  let otC: string;
  let otE: string;

  const http = () => request(app.getHttpServer());
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    jest.setTimeout(120_000);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    approvalService = app.get(ApprovalService);
    tenant = app.get(TenantContextService);

    const admin = await loginAdmin(app);
    authHeaders = bearer(admin.accessToken);
    adminUserId = admin.userId;
    otherAuthHeaders = bearer((await registerOrgAdmin(app, 'approval')).accessToken);

    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Sample", "Order", "Patient", "UidCounter" CASCADE`,
    );

    const stSerum = await http().post('/api/masters/sample-types').set(authHeaders).send({ name: 'Serum Tube V5' });
    expect(stSerum.status).toBe(201);

    const glu = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({
        testCode: 'V5-GLU',
        testName: 'V5 Glucose',
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
      .set(authHeaders)
      .send({
        testCode: 'V5-HBA',
        testName: 'V5 HbA1c',
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
        .set(authHeaders)
        .send({ patient: { firstName: name, lastName: 'Approve', gender: 'female', mobile, dob }, testIds, billing: {} });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    orderAId = await mkOrder('Alpha', '9550000001', '1985-01-01', [tGlu]);
    orderBId = await mkOrder('Beta', '9550000002', '1986-02-02', [tGlu, tHba]);
    orderCId = await mkOrder('Gamma', '9550000003', '1987-03-03', [tHba]);
    orderDId = await mkOrder('Delta', '9550000004', '1988-04-04', [tGlu]);
    orderEId = await mkOrder('Echo', '9550000005', '1989-05-05', [tGlu]);

    otA = (await plain.orderTest.findFirst({ where: { orderId: orderAId } }))!.id;
    otBGlu = (await plain.orderTest.findFirst({ where: { orderId: orderBId, testId: tGlu } }))!.id;
    otBHba = (await plain.orderTest.findFirst({ where: { orderId: orderBId, testId: tHba } }))!.id;
    otC = (await plain.orderTest.findFirst({ where: { orderId: orderCId } }))!.id;
    otE = (await plain.orderTest.findFirst({ where: { orderId: orderEId } }))!.id;

    // Collect the samples of A, B, C, E (each has one shared serum sample). D
    // stays UNCOLLECTED — its test remains pending forever in this suite.
    for (const orderId of [orderAId, orderBId, orderCId, orderEId]) {
      const sample = await plain.sample.findFirst({ where: { orderId } });
      await http().put(`/api/samples/${sample!.id}/collect`).set(authHeaders).expect(200);
    }

    const enter = (orderId: string, entries: Array<{ orderTestId: string; resultValue: string }>) =>
      http().put(`/api/orders/${orderId}/results`).set(authHeaders).send({ entries }).expect(200);

    await enter(orderCId, [{ orderTestId: otC, resultValue: '5.2' }]);
    await enter(orderBId, [
      { orderTestId: otBGlu, resultValue: '92' },
      { orderTestId: otBHba, resultValue: '5.6' },
    ]);
    await enter(orderAId, [{ orderTestId: otA, resultValue: '95' }]);
    await enter(orderEId, [{ orderTestId: otE, resultValue: '88' }]);
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  it('approval queue is empty before anything is verified', async () => {
    const res = await http().get('/api/approval-queue').set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('queue returns waiting orders oldest-verified-first with patient/wait/urgency info', async () => {
    // Verify OLDEST-FIRST with 15ms gaps so verifiedAt is deterministic: C,
    // then B, then A, then E. E is verified LAST on purpose — it stays
    // verified for the cross-tenant queue proof at the end of the suite.
    for (const orderId of [orderCId, orderBId, orderAId, orderEId]) {
      const tests = await plain.orderTest.findMany({ where: { orderId } });
      const res = await http()
        .put(`/api/orders/${orderId}/verify`)
        .set(authHeaders)
        .send({ orderTestIds: tests.map((t) => t.id) });
      expect(res.status).toBe(200);
      expect(res.body.verified).toHaveLength(tests.length);
      await sleep(15);
    }

    const res = await http().get('/api/approval-queue').set(authHeaders);
    expect(res.status).toBe(200);
    const queue = res.body as Array<{
      orderId: string;
      isUrgent: boolean;
      verifiedCount: number;
      verifiedAt: string | null;
      waitMs: number;
      patient: { patientUid: string; firstName: string; gender: string; ageYears: number };
    }>;

    expect(queue.map((q) => q.orderId)).toEqual([orderCId, orderBId, orderAId, orderEId]);
    expect(queue).not.toContainEqual(expect.objectContaining({ orderId: orderDId })); // never verified → absent

    const c = queue[0];
    expect(c.verifiedCount).toBe(1);
    expect(c.waitMs).toBeGreaterThanOrEqual(0);
    expect(c.isUrgent).toBe(false);
    expect(c.patient.firstName).toBe('Gamma');
    expect(c.patient.patientUid).toMatch(/^THU-2026-\d{4}$/);
    expect(c.patient.gender).toBe('female');
    expect(c.patient.ageYears).toBeGreaterThan(30);

    const b = queue[1];
    expect(b.verifiedCount).toBe(2); // both tests awaiting approval

    const times = queue.map((q) => new Date(q.verifiedAt!).getTime());
    expect(times[0]).toBeLessThanOrEqual(times[1]);
    expect(times[1]).toBeLessThanOrEqual(times[2]);
    expect(times[2]).toBeLessThanOrEqual(times[3]);
  });

  it('approve-review returns the FULL sheet (shared shape) PLUS the live-preview payload', async () => {
    const res = await http().get(`/api/orders/${orderBId}/approve-review`).set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(orderBId);
    expect(res.body.patient.firstName).toBe('Beta');

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
      approvedBy: string | null;
      approvedAt: string | null;
      approvalSignatureStamp: string | null;
    }>;
    expect(rows).toHaveLength(2);
    const glu = rows.find((r) => r.id === otBGlu)!;
    expect(glu.resultValue).toBe('92');
    expect(glu.unit).toBe('mg/dL');
    expect(glu.status).toBe('verified');
    expect(glu.verifiedBy).toBe(adminUserId);
    expect(glu.approvedBy).toBeNull();
    expect(glu.approvedAt).toBeNull();
    expect(glu.approvalSignatureStamp).toBeNull();
    expect(res.body.summary).toEqual({ total: 2, verified: 2, approved: 0 });

    // Live-preview payload: letterhead (org name), signature ref, QR placeholder.
    expect(res.body.preview.labName).toBe('Thulir Demo Lab');
    expect(res.body.preview.labAddress).toBeNull(); // Settings printable details are a later stage
    expect(res.body.preview.signatureRef).toBe(adminUserId);
    expect(res.body.preview.verificationCode).toMatch(/^THU-VR-[0-9A-Z]+-[0-9A-F]{4}$/);
    // Deterministic: same order → same code across calls.
    const again = await http().get(`/api/orders/${orderBId}/approve-review`).set(authHeaders);
    expect(again.body.preview.verificationCode).toBe(res.body.preview.verificationCode);
  });

  it('approving a single row sets status/actor/timestamp/signature-stamp and advances the rollup to approved', async () => {
    const before = new Date();
    const res = await http()
      .put(`/api/orders/${orderAId}/approve`)
      .set(authHeaders)
      .send({ orderTestIds: [otA] });
    expect(res.status).toBe(200);
    expect(res.body.approved).toHaveLength(1);
    expect(res.body.approved[0]).toEqual(
      expect.objectContaining({ orderTestId: otA, status: 'approved', approvalSignatureStamp: expect.stringMatching(/^[0-9A-F]{16}$/) }),
    );
    expect(res.body.skipped).toHaveLength(0);
    expect(res.body.orderStatus).toBe('approved'); // single test, all approved

    const row = await plain.orderTest.findUnique({ where: { id: otA } });
    expect(row!.status).toBe(OrderTestStatus.approved);
    expect(row!.approvedBy).toBe(adminUserId);
    expect(row!.approvedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(row!.approvalSignatureStamp).toMatch(/^[0-9A-F]{16}$/);
    // The approve never touches the result value or verify metadata.
    expect(row!.resultValue).toBe('95');
    expect(row!.verifiedBy).toBe(adminUserId);
    expect(row!.verifyRejectedNote).toBeNull();

    const order = await plain.order.findUnique({ where: { id: orderAId } });
    expect(order!.status).toBe('approved');
  });

  it('Approve All Visible only touches verified rows; already-approved rows are reported skipped and untouched', async () => {
    // otA is approved in ANOTHER order — not in B. For B: both rows verified.
    // First approve just one (otBGlu), then batch [otBGlu, otBHba]: the
    // already-approved row is reported skipped (0 rows) and its stamp is NOT
    // overwritten, the still-verified row lands.
    const first = await http().put(`/api/orders/${orderBId}/approve`).set(authHeaders).send({ orderTestIds: [otBGlu] });
    expect(first.status).toBe(200);
    expect(first.body.approved).toHaveLength(1);
    expect(first.body.orderStatus).toBe('partially_approved'); // one approved, one still verified

    const stampBefore = (await plain.orderTest.findUnique({ where: { id: otBGlu } }))!.approvalSignatureStamp;

    const res = await http()
      .put(`/api/orders/${orderBId}/approve`)
      .set(authHeaders)
      .send({ orderTestIds: [otBGlu, otBHba] });
    expect(res.status).toBe(200);
    expect(res.body.approved).toHaveLength(1);
    expect(res.body.approved[0].orderTestId).toBe(otBHba);
    expect(res.body.skipped).toHaveLength(1);
    expect(res.body.skipped[0].orderTestId).toBe(otBGlu);
    expect(res.body.skipped[0].reason).toBe('stale');
    expect(res.body.orderStatus).toBe('approved'); // both approved now

    const glu = await plain.orderTest.findUnique({ where: { id: otBGlu } });
    const hba = await plain.orderTest.findUnique({ where: { id: otBHba } });
    expect(glu!.status).toBe(OrderTestStatus.approved);
    expect(glu!.approvalSignatureStamp).toBe(stampBefore); // untouched by the skipped attempt
    expect(hba!.status).toBe(OrderTestStatus.approved);
    expect(hba!.approvalSignatureStamp).toMatch(/^[0-9A-F]{16}$/);

    const order = await plain.order.findUnique({ where: { id: orderBId } });
    expect(order!.status).toBe('approved');
  });

  it('reject-back-to-verify: approved row → SAME entered state, ALL metadata cleared, resultValue INTACT, 409 when not verified/approved', async () => {
    const rejected = await http()
      .put(`/api/orders/${orderBId}/reject-back-to-verify`)
      .set(authHeaders)
      .send({ orderTestId: otBGlu, reason: 'Value inconsistent with clinical picture' });
    expect(rejected.status).toBe(200);
    expect(rejected.body).toEqual(
      expect.objectContaining({ orderTestId: otBGlu, status: 'entered', verifyRejectedNote: 'Value inconsistent with clinical picture' }),
    );
    // Rollup moved back down: entered + approved → all at least entered, one
    // not verified → partially_verified (never a fifth quasi-state).
    expect(rejected.body.orderStatus).toBe('partially_verified');

    const row = await plain.orderTest.findUnique({ where: { id: otBGlu } });
    expect(row!.status).toBe(OrderTestStatus.entered);
    expect(row!.verifyRejectedNote).toBe('Value inconsistent with clinical picture');
    expect(row!.verifiedBy).toBeNull();
    expect(row!.verifiedAt).toBeNull();
    expect(row!.approvedBy).toBeNull();
    expect(row!.approvedAt).toBeNull();
    expect(row!.approvalSignatureStamp).toBeNull();
    expect(row!.resultValue).toBe('92'); // NEVER touched — corrected via Result Entry

    const order = await plain.order.findUnique({ where: { id: orderBId } });
    expect(order!.status).toBe('partially_verified');

    // Second reject-back on the now-entered row → 409, never a silent no-op.
    const again = await http()
      .put(`/api/orders/${orderBId}/reject-back-to-verify`)
      .set(authHeaders)
      .send({ orderTestId: otBGlu, reason: 'again' });
    expect(again.status).toBe(409);
    expect(again.body.message).toContain('V5 Glucose');
  });

  it('CONCURRENCY: two simultaneous approve requests on the same verified row → exactly one lands, one skipped', async () => {
    // otC (order C) is still verified — nothing has approved it yet.
    const [a, b] = await Promise.all([
      http().put(`/api/orders/${orderCId}/approve`).set(authHeaders).send({ orderTestIds: [otC] }),
      http().put(`/api/orders/${orderCId}/approve`).set(authHeaders).send({ orderTestIds: [otC] }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const landed = [a, b].filter((r) => r.body.approved.length === 1);
    const skipped = [a, b].filter((r) => r.body.skipped.length === 1);
    expect(landed).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].body.skipped[0].reason).toBe('stale');

    // Exactly ONE approved row with a single approvedAt + stamp — no double write.
    const rows = await plain.orderTest.findMany({ where: { id: otC } });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(OrderTestStatus.approved);
    expect(rows[0].approvedAt).not.toBeNull();
    expect(rows[0].approvalSignatureStamp).toMatch(/^[0-9A-F]{16}$/);
  });

  it('validation: empty approve batch and missing reject reason are rejected (400)', async () => {
    const empty = await http().put(`/api/orders/${orderAId}/approve`).set(authHeaders).send({ orderTestIds: [] });
    expect(empty.status).toBe(400);

    const noReason = await http()
      .put(`/api/orders/${orderBId}/reject-back-to-verify`)
      .set(authHeaders)
      .send({ orderTestId: otBHba, reason: '' });
    expect(noReason.status).toBe(400);
  });

  it('approval is fail-closed under tenant scoping against the real connection', async () => {
    // No tenant context → throws before any SQL is issued.
    await expect(approvalService.getApprovalQueue()).rejects.toThrow(TenantContextError);

    // Order E is STILL verified (never approved in this suite) → the same-
    // tenant queue shows it, the cross-tenant queue is empty (no leak).
    const sameQueue = await http().get('/api/approval-queue').set(authHeaders);
    expect(sameQueue.status).toBe(200);
    expect(sameQueue.body.map((q: { orderId: string }) => q.orderId)).toEqual([orderEId]);

    const otherQueue = await http().get('/api/approval-queue').set(otherAuthHeaders);
    expect(otherQueue.status).toBe(200);
    expect(otherQueue.body).toEqual([]);

    // Cross-tenant approve-review → the ownership post-check throws (fail-
    // closed, no data leak) — asserted at the service level, same pattern as
    // the samples/verify suites' cross-tenant point-read assertions.
    await expect(tenant.run('org_other', () => approvalService.getApproveReview(orderAId))).rejects.toThrow(TenantContextError);

    // Cross-tenant approve on order E's VERIFIED row → orgId ANDed in, zero
    // rows affected → reported skipped, row unchanged (safe, not a leak).
    const otherApprove = await http()
      .put(`/api/orders/${orderEId}/approve`)
      .set(otherAuthHeaders)
      .send({ orderTestIds: [otE] });
    expect(otherApprove.status).toBe(200);
    expect(otherApprove.body.approved).toHaveLength(0);
    expect(otherApprove.body.skipped).toHaveLength(1);

    // Cross-tenant reject-back on order B's approved row → 409, row unchanged.
    const otherReject = await http()
      .put(`/api/orders/${orderBId}/reject-back-to-verify`)
      .set(otherAuthHeaders)
      .send({ orderTestId: otBHba, reason: 'nope' });
    expect(otherReject.status).toBe(409);

    const eRow = await plain.orderTest.findUnique({ where: { id: otE } });
    expect(eRow!.status).toBe(OrderTestStatus.verified); // untouched by the cross-tenant approve
    const bRow = await plain.orderTest.findUnique({ where: { id: otBHba } });
    expect(bRow!.status).toBe(OrderTestStatus.approved); // untouched by the cross-tenant reject
  });
});
