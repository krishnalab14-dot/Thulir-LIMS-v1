import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { verificationCode } from '../src/common/report-code.util';
import { TenantContextError, TenantContextService } from '../src/prisma/tenant-context.service';
import { ReportsService } from '../src/reports/reports.service';
import { bearer, loginAdmin, registerOrgAdmin } from './test-helpers';

/**
 * REAL-DATABASE Stage 6 (Report) suite — same bar as every prior stage.
 * Runs inside `npm run verify:real-db` against real Postgres over the real
 * Nest HTTP stack. Covers the §5 regression scenarios:
 *   1. fully-approved order → GET /orders/:id/report returns full data;
 *   2. order with a single non-approved test → 409, nothing returned;
 *   3. public verify, correct order number + correct DOB → minimal payload
 *      with NO patient name / results / test list;
 *   4. correct order number + wrong DOB → the SAME { valid: false } body as a
 *      nonexistent order number (asserted deep-equal, byte-identical shape);
 *   5. nonexistent order number → { valid: false };
 *   6. cross-tenant: the public endpoint works with any tenant header (order
 *      numbers are globally unique — no tenant hint in the public API);
 *   + validation: missing/malformed params → 400; reportGeneratedAt set once.
 *   (§7 print-stylesheet visual check is manual — noted in the build record.)
 */
describe('Stage 6 real-DB verification — report + public verify', () => {
  let app: INestApplication;
  let reportsService: ReportsService;
  let tenant: TenantContextService;
  const plain = new PrismaClient();

  let authHeaders: Record<string, string>;
  let otherAuthHeaders: Record<string, string>;
  let adminUserId: string;

  let tGlu: string; // V6 Glucose — serum, 70-99, critical 40-400, unit mg/dL
  let tHba: string; // V6 HbA1c — serum, 4-6, critical 3-8

  let orderFullId: string; // [glu, hba] — fully approved; the report + public-verify target
  let orderPartialId: string; // [glu] — entered only; never ready for a report

  let codeFull: string; // verification code of orderFull
  let otGluFull: string;
  let otHbaFull: string;
  let otPartial: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    jest.setTimeout(120_000);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    reportsService = app.get(ReportsService);
    tenant = app.get(TenantContextService);

    const admin = await loginAdmin(app);
    authHeaders = bearer(admin.accessToken);
    adminUserId = admin.userId;
    otherAuthHeaders = bearer((await registerOrgAdmin(app, 'report')).accessToken);

    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Sample", "Order", "Patient", "UidCounter" CASCADE`,
    );

    const stSerum = await http().post('/api/masters/sample-types').set(authHeaders).send({ name: 'Serum Tube V6' });
    expect(stSerum.status).toBe(201);

    const glu = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({
        testCode: 'V6-GLU',
        testName: 'V6 Glucose',
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
        testCode: 'V6-HBA',
        testName: 'V6 HbA1c',
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
        .send({ patient: { firstName: name, lastName: 'Report', gender: 'female', mobile, dob }, testIds, billing: {} });
      expect(res.status).toBe(201);
      return res.body.id as string;
    };

    orderFullId = await mkOrder('Fully', '9660000001', '1985-01-01', [tGlu, tHba]);
    orderPartialId = await mkOrder('Partial', '9660000002', '1986-02-02', [tGlu]);

    otGluFull = (await plain.orderTest.findFirst({ where: { orderId: orderFullId, testId: tGlu } }))!.id;
    otHbaFull = (await plain.orderTest.findFirst({ where: { orderId: orderFullId, testId: tHba } }))!.id;
    otPartial = (await plain.orderTest.findFirst({ where: { orderId: orderPartialId } }))!.id;

    // Collect both orders' samples.
    for (const orderId of [orderFullId, orderPartialId]) {
      const sample = await plain.sample.findFirst({ where: { orderId } });
      await http().put(`/api/samples/${sample!.id}/collect`).set(authHeaders).expect(200);
    }

    // Enter results for both.
    await http()
      .put(`/api/orders/${orderFullId}/results`)
      .set(authHeaders)
      .send({ entries: [{ orderTestId: otGluFull, resultValue: '92' }, { orderTestId: otHbaFull, resultValue: '5.6' }] })
      .expect(200);
    await http()
      .put(`/api/orders/${orderPartialId}/results`)
      .set(authHeaders)
      .send({ entries: [{ orderTestId: otPartial, resultValue: '95' }] })
      .expect(200);

    // Verify + approve EVERYTHING in orderFull → fully approved. orderPartial
    // stays entered — the 409 gate target.
    await http().put(`/api/orders/${orderFullId}/verify`).set(authHeaders).send({ orderTestIds: [otGluFull, otHbaFull] }).expect(200);
    const approve = await http().put(`/api/orders/${orderFullId}/approve`).set(authHeaders).send({ orderTestIds: [otGluFull, otHbaFull] });
    expect(approve.status).toBe(200);
    expect(approve.body.approved).toHaveLength(2);
    expect(approve.body.orderStatus).toBe('approved');
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  it('§5.1: fully-approved order → report returns the full data', async () => {
    const before = new Date();
    const res = await http().get(`/api/orders/${orderFullId}/report`).set(authHeaders);
    expect(res.status).toBe(200);

    const body = res.body;
    expect(body.order.id).toBe(orderFullId);
    expect(body.order.status).toBe('approved');
    expect(body.order.verificationCode).toMatch(/^THU-VR-[0-9A-Z]{8}-[0-9A-F]{4}$/);
    codeFull = body.order.verificationCode;

    expect(body.patient).toEqual(
      expect.objectContaining({ patientUid: expect.stringMatching(/^THU-2026-\d{4}$/), firstName: 'Fully', lastName: 'Report', gender: 'female' }),
    );
    expect(body.patient.ageYears).toBeGreaterThan(30);

    const rows = body.samples.flatMap((s: { orderTests: unknown[] }) => s.orderTests) as Array<{
      id: string;
      testNameSnapshot: string;
      status: string;
      resultValue: string | null;
      unit: string | null;
      refLow: number | null;
      refHigh: number | null;
      approvedBy: string | null;
      approvedAt: string | null;
      approvalSignatureStamp: string | null;
    }>;
    expect(rows).toHaveLength(2);
    const glu = rows.find((r) => r.id === otGluFull)!;
    const hba = rows.find((r) => r.id === otHbaFull)!;
    expect(glu).toEqual(
      expect.objectContaining({ testNameSnapshot: 'V6 Glucose', status: 'approved', resultValue: '92', unit: 'mg/dL', refLow: 70, refHigh: 99 }),
    );
    expect(hba).toEqual(
      expect.objectContaining({ testNameSnapshot: 'V6 HbA1c', status: 'approved', resultValue: '5.6', refLow: 4, refHigh: 6 }),
    );
    expect(glu.approvedBy).toBe(adminUserId);
    expect(glu.approvalSignatureStamp).toMatch(/^[0-9A-F]{16}$/);
    expect(body.summary).toEqual({ total: 2 });

    // Lab letterhead (name only — printable address fields are a later stage).
    expect(body.lab).toEqual({ labName: 'Thulir Demo Lab', labAddress: null });
    expect(body.signature.signatureRef).toBe(adminUserId);
    expect(body.signature.stamp).toMatch(/^[0-9A-F]{16}$/);

    // The verification payload points at the public page with this code.
    expect(body.verify.code).toBe(codeFull);
    expect(body.verify.path).toBe(`/verify-report?orderNumber=${encodeURIComponent(codeFull)}`);

    // reportGeneratedAt stamped on first generation, dated today.
    expect(new Date(body.order.reportGeneratedAt).getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
    expect(new Date(body.order.reportGeneratedAt).toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10));

    // §2 decision: issued-once — a second view keeps the SAME issue date.
    const again = await http().get(`/api/orders/${orderFullId}/report`).set(authHeaders);
    expect(again.status).toBe(200);
    expect(again.body.order.reportGeneratedAt).toBe(body.order.reportGeneratedAt);
  });

  it('§5.2: an order with a single non-approved test → 409, nothing returned', async () => {
    const res = await http().get(`/api/orders/${orderPartialId}/report`).set(authHeaders);
    expect(res.status).toBe(409);
    expect(res.body.message).toContain('V6 Glucose');
    expect(res.body.message).toContain('not ready');

    // The DB row never got a report issue stamp from the rejected attempt.
    const order = await plain.order.findUnique({ where: { id: orderPartialId } });
    expect(order!.reportGeneratedAt).toBeNull();
  });

  it('§5.3: public verify with correct order number + DOB → minimal payload, no patient name/results', async () => {
    const res = await http()
      .get('/api/public/verify-report')
      .set(authHeaders)
      .query({ orderNumber: codeFull, dob: '1985-01-01' });
    expect(res.status).toBe(200);
    // EXACT shape — nothing beyond the four allowed fields.
    expect(res.body).toEqual({
      valid: true,
      orderNumber: codeFull,
      labName: 'Thulir Demo Lab',
      reportDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    // Explicitly no patient name / results / test list.
    const keys = Object.keys(res.body).sort();
    expect(keys).toEqual(['labName', 'orderNumber', 'reportDate', 'valid']);
    expect(JSON.stringify(res.body)).not.toContain('Fully');
  });

  it('§5.4 + §5.5: wrong DOB, nonexistent order, and not-approved order → byte-identical { valid: false }', async () => {
    const wrongDob = await http()
      .get('/api/public/verify-report')
      .set(authHeaders)
      .query({ orderNumber: codeFull, dob: '1999-09-09' });
    const nonexistent = await http()
      .get('/api/public/verify-report')
      .set(authHeaders)
      .query({ orderNumber: 'THU-VR-XXXXXXXX-0000', dob: '1985-01-01' });
    const notApproved = await http()
      .get('/api/public/verify-report')
      .set(authHeaders)
      .query({ orderNumber: verificationCode(orderPartialId), dob: '1986-02-02' });

    expect(wrongDob.status).toBe(200);
    expect(nonexistent.status).toBe(200);
    expect(notApproved.status).toBe(200);

    const invalidBody = { valid: false };
    expect(wrongDob.body).toEqual(invalidBody);
    expect(nonexistent.body).toEqual(invalidBody);
    expect(notApproved.body).toEqual(invalidBody);
    // The three failure bodies are byte-identical — no distinguishable signal.
    expect(JSON.stringify(wrongDob.body)).toBe(JSON.stringify(nonexistent.body));
    expect(JSON.stringify(nonexistent.body)).toBe(JSON.stringify(notApproved.body));
  });

  it('§5.6: public verify works regardless of the tenant header — order numbers are globally unique', async () => {
    // Same order + DOB, but with a DIFFERENT tenant header: still valid. The
    // public endpoint never consults the tenant header (raw lookup by the
    // globally-unique code) — no tenant-scoping bypass needed, none possible.
    const res = await http()
      .get('/api/public/verify-report')
      .set(otherAuthHeaders)
      .query({ orderNumber: codeFull, dob: '1985-01-01' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      valid: true,
      orderNumber: codeFull,
      labName: 'Thulir Demo Lab',
      reportDate: expect.any(String),
    });
    // And with NO tenant header at all (a bare printed-QR scan).
    const bare = await http().get('/api/public/verify-report').query({ orderNumber: codeFull, dob: '1985-01-01' });
    expect(bare.status).toBe(200);
    expect(bare.body.valid).toBe(true);
  });

  it('public verify also accepts the raw order id as the order number', async () => {
    const res = await http()
      .get('/api/public/verify-report')
      .set(authHeaders)
      .query({ orderNumber: orderFullId, dob: '1985-01-01' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({ valid: true, orderNumber: codeFull }));
  });

  it('validation: missing or malformed params → 400 (client errors, never a signal about order existence)', async () => {
    const noNumber = await http().get('/api/public/verify-report').set(authHeaders).query({ dob: '1985-01-01' });
    expect(noNumber.status).toBe(400);

    const noDob = await http().get('/api/public/verify-report').set(authHeaders).query({ orderNumber: codeFull });
    expect(noDob.status).toBe(400);

    const badDob = await http()
      .get('/api/public/verify-report')
      .set(authHeaders)
      .query({ orderNumber: codeFull, dob: '01/01/1985' });
    expect(badDob.status).toBe(400);
  });

  it('report endpoint is tenant fail-closed like every other internal route', async () => {
    // Cross-tenant report → the ownership post-check on findUnique throws
    // (the public verify endpoint is the ONLY tenant-free lookup). Asserted
    // at the service level, same pattern as the samples/verify/approval
    // suites' cross-tenant point-read assertions; the HTTP path surfaces a
    // generic 500 with no detail.
    await expect(tenant.run('org_other', () => reportsService.getReport(orderFullId))).rejects.toThrow(TenantContextError);

    const res = await http().get(`/api/orders/${orderFullId}/report`).set(otherAuthHeaders);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ statusCode: 500, message: 'Internal server error' });
  });
});
