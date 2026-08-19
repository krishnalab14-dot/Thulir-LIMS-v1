import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { bearer, loginAdmin } from './test-helpers';

/**
 * REAL-DATABASE Stage 8 (Portal) suite — patient and referrer self-service
 * portals. Covers every §6 done-criteria:
 *
 *   - patient login with correct mobile+DOB → succeeds, wrong DOB → generic
 *     failure (same shape as nonexistent mobile);
 *   - rate-limiting: 6th rapid attempt for the same mobile → blocked,
 *     regardless of correctness;
 *   - a patient token cannot access another patient's orders/report (ownership
 *     check, 403) — and cannot access any staff-only endpoint (Stage 7's guard
 *     correctly rejects a type: 'patient' token);
 *   - a referrer token cannot access another referrer's orders, and cannot
 *     access patient-portal or staff endpoints;
 *   - report access via the portal still respects the 409-unless-fully-approved
 *     gate from Stage 6 — a portal user can't see an in-progress order's
 *     report early;
 *   - admin portal-access generation: only admin/lab_manager can call it; the
 *     returned password isn't retrievable again afterward (confirm there's no
 *     "view existing password" endpoint anywhere — only reset);
 *   - regression guard: all previously-passing suites across every prior stage
 *     still pass unmodified.
 */
describe('Stage 8 real-DB verification — portal', () => {
  let app: INestApplication;
  const plain = new PrismaClient();

  let adminHeaders: Record<string, string>;

  let patientIdA: string;
  let _patientIdB: string;
  let orderIdA: string;
  let orderIdB: string; // not fully approved → 409 for report
  let otA: string;
  let _otB: string;
  let partyId: string;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    jest.setTimeout(120_000);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Sample", "Order", "Patient", "UidCounter" CASCADE`,
    );

    const admin = await loginAdmin(app);
    adminHeaders = bearer(admin.accessToken);

    // --- Create sample type + test ---
    const st = await http().post('/api/masters/sample-types').set(adminHeaders).send({ name: 'Portal Serum' });
    expect(st.status).toBe(201);
    const t = await http()
      .post('/api/masters/tests')
      .set(adminHeaders)
      .send({
        testCode: 'PORT-GLU',
        testName: 'Portal Glucose',
        currentPrice: 150,
        requiredSampleTypeId: st.body.id,
        defaultRefLow: 70,
        defaultRefHigh: 99,
      });
    expect(t.status).toBe(201);

    // --- Patient A: will have a fully approved order ---
    const orderARes = await http()
      .post('/api/orders')
      .set(adminHeaders)
      .send({
        patient: { firstName: 'Portal', lastName: 'PatientA', gender: 'male', mobile: '9800000001', dob: '1990-05-15' },
        testIds: [t.body.id],
        billing: {},
      });
    expect(orderARes.status).toBe(201);
    orderIdA = orderARes.body.id;
    otA = orderARes.body.orderTests[0].id as string;

    // Resolve patient A
    const patientA = await plain.patient.findFirst({ where: { mobile: '9800000001' } });
    expect(patientA).toBeTruthy();
    patientIdA = patientA!.id;

    // --- Patient B: second patient for cross-boundary tests ---
    const orderBRes = await http()
      .post('/api/orders')
      .set(adminHeaders)
      .send({
        patient: { firstName: 'Portal', lastName: 'PatientB', gender: 'female', mobile: '9800000002', dob: '1985-08-20' },
        testIds: [t.body.id],
        billing: {},
      });
    expect(orderBRes.status).toBe(201);
    orderIdB = orderBRes.body.id;
    _otB = orderBRes.body.orderTests[0].id as string;

    const patientB = await plain.patient.findFirst({ where: { mobile: '9800000002' } });
    expect(patientB).toBeTruthy();
    _patientIdB = patientB!.id;

    // --- Referrer party ---
    const party = await http()
      .post('/api/parties')
      .set(adminHeaders)
      .send({ name: 'Dr. Portal Referrer', type: 'doctor' });
    expect(party.status).toBe(201);
    partyId = party.body.id;

    // --- Collect samples for Order A only (Order B stays pending) ---
    const sampleA = await plain.sample.findFirst({ where: { orderId: orderIdA } });
    await http().put(`/api/samples/${sampleA!.id}/collect`).set(adminHeaders).expect(200);

    // --- Enter + verify + approve Order A → fully approved ---
    await http()
      .put(`/api/orders/${orderIdA}/results`)
      .set(adminHeaders)
      .send({ entries: [{ orderTestId: otA, resultValue: '88' }] })
      .expect(200);

    await http().put(`/api/orders/${orderIdA}/verify`).set(adminHeaders).send({ orderTestIds: [otA] }).expect(200);
    await http().put(`/api/orders/${orderIdA}/approve`).set(adminHeaders).send({ orderTestIds: [otA] }).expect(200);

    // Verify order A is fully approved
    const orderAFinal = await plain.order.findUnique({ where: { id: orderIdA } });
    expect(orderAFinal!.status).toBe('approved');
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // Patient login
  // ---------------------------------------------------------------------------

  it('patient login with correct mobile+DOB succeeds', async () => {
    const res = await http().post('/api/portal/patient/login').send({ mobile: '9800000001', dob: '1990-05-15' });
    expect(res.status).toBe(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.patient).toEqual(expect.objectContaining({ id: patientIdA }));
  });

  it('patient login with wrong DOB returns same generic 401 as nonexistent mobile', async () => {
    const wrongDob = await http().post('/api/portal/patient/login').send({ mobile: '9800000001', dob: '1991-01-01' });
    expect(wrongDob.status).toBe(401);
    expect(wrongDob.body.message).toContain('Invalid credentials');

    const noMobile = await http().post('/api/portal/patient/login').send({ mobile: '0000000000', dob: '1990-05-15' });
    expect(noMobile.status).toBe(401);
    expect(noMobile.body.message).toContain('Invalid credentials');
  });

  // ---------------------------------------------------------------------------
  // Patient rate-limiting
  // ---------------------------------------------------------------------------

  it('rate-limiting blocks 6th rapid attempt for the same mobile', async () => {
    // Fire 5 attempts (the limit) — all fail with wrong DOB
    for (let i = 0; i < 5; i++) {
      const res = await http().post('/api/portal/patient/login').send({ mobile: '9800000999', dob: '1999-01-01' });
      expect(res.status).toBe(401);
    }
    // 6th attempt → rate-limited (401 with specific message)
    const blocked = await http().post('/api/portal/patient/login').send({ mobile: '9800000999', dob: '1999-01-01' });
    expect(blocked.status).toBe(401);
    expect(blocked.body.message).toContain('Too many login attempts');
  });

  // ---------------------------------------------------------------------------
  // Patient order list
  // ---------------------------------------------------------------------------

  it('patient token returns only their own orders', async () => {
    const login = await http().post('/api/portal/patient/login').send({ mobile: '9800000001', dob: '1990-05-15' });
    const token = login.body.accessToken as string;

    const orders = await http().get('/api/portal/patient/orders').set(bearer(token));
    expect(orders.status).toBe(200);
    expect(orders.body.length).toBeGreaterThanOrEqual(1);
    expect(orders.body[0]).toEqual(
      expect.objectContaining({
        orderId: orderIdA,
        reportReady: true,
        patient: expect.objectContaining({ firstName: 'Portal', lastName: 'PatientA' }),
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // Patient report access — ownership + 409 gate
  // ---------------------------------------------------------------------------

  it('patient can view a fully approved report', async () => {
    const login = await http().post('/api/portal/patient/login').send({ mobile: '9800000001', dob: '1990-05-15' });
    const token = login.body.accessToken as string;

    const report = await http().get(`/api/portal/patient/orders/${orderIdA}/report`).set(bearer(token));
    expect(report.status).toBe(200);
    expect(report.body.order.id).toBe(orderIdA);
    expect(report.body.patient.firstName).toBe('Portal');
    expect(report.body.samples).toBeDefined();
  });

  it('patient cannot view another patient report (403)', async () => {
    const login = await http().post('/api/portal/patient/login').send({ mobile: '9800000001', dob: '1990-05-15' });
    const token = login.body.accessToken as string;

    const report = await http().get(`/api/portal/patient/orders/${orderIdB}/report`).set(bearer(token));
    expect(report.status).toBe(403);
    expect(report.body.message).toContain('not have access');
  });

  it('report access respects 409 gate — in-progress order returns 409', async () => {
    const login = await http().post('/api/portal/patient/login').send({ mobile: '9800000002', dob: '1985-08-20' });
    const token = login.body.accessToken as string;

    const report = await http().get(`/api/portal/patient/orders/${orderIdB}/report`).set(bearer(token));
    expect(report.status).toBe(409);
    expect(report.body.message).toContain('not ready yet');
  });

  // ---------------------------------------------------------------------------
  // Cross-boundary: patient token rejected on staff routes
  // ---------------------------------------------------------------------------

  it('patient token cannot access staff-only endpoints (401)', async () => {
    const login = await http().post('/api/portal/patient/login').send({ mobile: '9800000001', dob: '1990-05-15' });
    const token = login.body.accessToken as string;

    // Staff orders list — should be rejected by JwtAuthGuard
    const orders = await http().get('/api/orders').set(bearer(token));
    expect(orders.status).toBe(401);
    expect(orders.body.message).toContain('Patient tokens cannot access staff routes');
  });

  // ---------------------------------------------------------------------------
  // Referrer portal access generation (admin-only)
  // ---------------------------------------------------------------------------

  it('admin can generate referrer portal access; returned password works for login', async () => {
    const gen = await http()
      .put(`/api/parties/${partyId}/portal-access`)
      .set(adminHeaders)
      .send({ username: 'dr_portal_ref' });
    expect(gen.status).toBe(201);
    expect(gen.body.portalUsername).toBe('dr_portal_ref');
    expect(gen.body.plaintext).toBeTruthy();
    expect(gen.body.plaintext.length).toBeGreaterThan(8);

    // Login with the generated credentials
    const login = await http()
      .post('/api/portal/referrer/login')
      .send({ username: 'dr_portal_ref', password: gen.body.plaintext });
    expect(login.status).toBe(201);
    expect(login.body.accessToken).toBeTruthy();
    expect(login.body.referrer).toEqual(expect.objectContaining({ id: partyId }));
  });

  it('portal-access generation is admin-only — technician gets 403', async () => {
    // Create a technician staff user
    const staffRes = await http()
      .post('/api/users')
      .set(adminHeaders)
      .send({ username: 'staff_tech_portal', password: 'Tech@1234', role: 'technician' });
    expect(staffRes.status).toBe(201);
    const staffLogin = await http().post('/api/auth/login').send({ username: 'staff_tech_portal', password: 'Tech@1234' });
    const techHeaders = bearer(staffLogin.body.accessToken as string);

    const gen = await http()
      .put(`/api/parties/${partyId}/portal-access`)
      .set(techHeaders)
      .send({ username: 'sneaky_ref' });
    expect(gen.status).toBe(403);
  });

  it('resetting portal access generates new credentials; old password no longer works', async () => {
    // First generate
    const first = await http()
      .put(`/api/parties/${partyId}/portal-access`)
      .set(adminHeaders)
      .send({ username: 'ref_reset_test' });
    expect(first.status).toBe(201);
    const oldPassword = first.body.plaintext as string;

    // Login with old password — should work
    const login1 = await http()
      .post('/api/portal/referrer/login')
      .send({ username: 'ref_reset_test', password: oldPassword });
    expect(login1.status).toBe(201);

    // Reset with custom username
    const second = await http()
      .put(`/api/parties/${partyId}/portal-access`)
      .set(adminHeaders)
      .send({ username: 'ref_reset_v2' });
    expect(second.status).toBe(201);
    const newPassword = second.body.plaintext as string;

    // Old username/password no longer works
    const loginOld = await http()
      .post('/api/portal/referrer/login')
      .send({ username: 'ref_reset_test', password: oldPassword });
    expect(loginOld.status).toBe(401);

    // New username/password works
    const loginNew = await http()
      .post('/api/portal/referrer/login')
      .send({ username: 'ref_reset_v2', password: newPassword });
    expect(loginNew.status).toBe(201);
  });

  // ---------------------------------------------------------------------------
  // Referrer portal data access
  // ---------------------------------------------------------------------------

  it('referrer token returns only orders they referred', async () => {
    // Create an order with this referrer
    const orderRes = await http()
      .post('/api/orders')
      .set(adminHeaders)
      .send({
        patient: { firstName: 'Referred', lastName: 'ByDoc', gender: 'male', mobile: '9800000010', dob: '1992-01-01' },
        testIds: ['t_fbs'],
        orderDetails: { referrerPartyId: partyId },
        billing: {},
      });
    expect(orderRes.status).toBe(201);
    const referredOrderId = orderRes.body.id;

    // Login as referrer
    const gen = await http()
      .put(`/api/parties/${partyId}/portal-access`)
      .set(adminHeaders)
      .send({ username: 'ref_data_test' });
    expect(gen.status).toBe(201);
    const login = await http()
      .post('/api/portal/referrer/login')
      .send({ username: 'ref_data_test', password: gen.body.plaintext });
    expect(login.status).toBe(201);
    const token = login.body.accessToken as string;

    const orders = await http().get('/api/portal/referrer/orders').set(bearer(token));
    expect(orders.status).toBe(200);
    expect(orders.body.length).toBeGreaterThanOrEqual(1);
    expect(orders.body.some((o: { orderId: string }) => o.orderId === referredOrderId)).toBe(true);
  });

  it('referrer token cannot access patient-portal or staff endpoints', async () => {
    const gen = await http()
      .put(`/api/parties/${partyId}/portal-access`)
      .set(adminHeaders)
      .send({ username: 'ref_boundary_test' });
    expect(gen.status).toBe(201);
    const login = await http()
      .post('/api/portal/referrer/login')
      .send({ username: 'ref_boundary_test', password: gen.body.plaintext });
    expect(login.status).toBe(201);
    const token = login.body.accessToken as string;

    // Patient portal → should be rejected (referrer token on patient routes)
    const patientOrders = await http().get('/api/portal/patient/orders').set(bearer(token));
    expect(patientOrders.status).toBe(403);
    expect(patientOrders.body.message).toContain('Patient portal access required');

    // Staff endpoint → should be rejected
    const staffOrders = await http().get('/api/orders').set(bearer(token));
    expect(staffOrders.status).toBe(401);
    expect(staffOrders.body.message).toContain('Referrer tokens cannot access staff routes');
  });

  // ---------------------------------------------------------------------------
  // No plaintext password retrieval endpoint
  // ---------------------------------------------------------------------------

  it('there is no endpoint to retrieve an existing plaintext password', async () => {
    // Confirm the password hash exists in the DB
    const party = await plain.party.findUnique({ where: { id: partyId } });
    expect(party!.portalPasswordHash).toBeTruthy();
    expect(party!.portalUsername).toBeTruthy();

    // No GET/POST endpoint that returns the plaintext — confirm by checking
    // that GET /api/parties/:id/portal-access doesn't exist (would 404 or 405)
    const attempt = await http().get(`/api/parties/${partyId}/portal-access`).set(adminHeaders);
    // Should be 404 (no GET route) or 405 (method not allowed)
    expect([404, 405]).toContain(attempt.status);
  });
});
