import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { bearer, loginAdmin } from './test-helpers';

/**
 * Registration Refinement integration suite — referral-type cascading,
 * self/walk-in (referrerPartyId = null), discount authorization audit,
 * expected report date, and party search with new types.
 *
 * Runs via `npm run verify:real-db` against real Postgres.
 */
describe('Registration refinement (real-DB)', () => {
  let app: INestApplication;
  const plain = new PrismaClient();
  let authHeaders: Record<string, string>;
  let adminUserId: string;

  let testXId: string;
  let partyDoctorId: string;
  let partyHospId: string;
  let partyLabId: string;

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
    adminUserId = admin.userId;

    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Order", "Patient", "UidCounter" CASCADE`,
    );

    // Create a test for order creation
    const testRes = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({ testCode: 'REF-X', testName: 'Refinement Test X', currentPrice: 200, defaultRefLow: 0, defaultRefHigh: 100 });
    expect(testRes.status).toBe(201);
    testXId = testRes.body.id;

    // Create parties of different types
    const docRes = await http()
      .post('/api/parties')
      .set(authHeaders)
      .send({ name: 'Dr. Refinement Test', type: 'doctor' });
    expect(docRes.status).toBe(201);
    partyDoctorId = docRes.body.id;

    const hospRes = await http()
      .post('/api/parties')
      .set(authHeaders)
      .send({ name: 'City Hospital Refinement', type: 'hospital' });
    expect(hospRes.status).toBe(201);
    partyHospId = hospRes.body.id;

    const labRes = await http()
      .post('/api/parties')
      .set(authHeaders)
      .send({ name: 'Central Reference Lab', type: 'reference_lab' });
    expect(labRes.status).toBe(201);
    partyLabId = labRes.body.id;
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // §1 Party search — new types
  // ---------------------------------------------------------------------------

  it('party search with type=reference_lab returns only reference_lab parties', async () => {
    const res = await http().get('/api/parties/search?type=reference_lab&q=Central').set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe(partyLabId);
    expect(res.body[0].type).toBe('reference_lab');
  });

  it('party search with type=hospital does not return doctor or reference_lab parties', async () => {
    const res = await http().get('/api/parties/search?type=hospital&q=').set(authHeaders);
    expect(res.status).toBe(200);
    const types = res.body.map((p: { type: string }) => p.type);
    expect(types).not.toContain('doctor');
    expect(types).not.toContain('reference_lab');
    expect(types).toContain('hospital');
  });

  // ---------------------------------------------------------------------------
  // §2 Self / Walk-in — referrerPartyId = null
  // ---------------------------------------------------------------------------

  it('order with no referrerPartyId (self/walk-in) creates order with referrerPartyId = null', async () => {
    const res = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: { firstName: 'SelfWalk', lastName: 'Patient', gender: 'male', mobile: '9700000001', dob: '1995-06-15' },
        orderDetails: { isUrgent: false },
        testIds: [testXId],
        billing: {},
      });
    expect(res.status).toBe(201);
    expect(res.body.referrerPartyId).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // §3 Referral-type scoping — doctor referrer is set correctly
  // ---------------------------------------------------------------------------

  it('order with doctor referrerPartyId records the correct party', async () => {
    const res = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: { firstName: 'RefDr', lastName: 'Patient', gender: 'female', mobile: '9700000002', dob: '1988-03-22' },
        orderDetails: { referrerPartyId: partyDoctorId, isUrgent: false },
        testIds: [testXId],
        billing: {},
      });
    expect(res.status).toBe(201);
    expect(res.body.referrerPartyId).toBe(partyDoctorId);
  });

  // ---------------------------------------------------------------------------
  // §4 Switching referral type — stale referrer cleared (frontend concern, but
  //    backend rejects invalid party ids)
  // ---------------------------------------------------------------------------

  it('order with hospital referrerPartyId records the correct party', async () => {
    const res = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: { firstName: 'RefHosp', lastName: 'Patient', gender: 'other', mobile: '9700000003', dob: '2000-01-01' },
        orderDetails: { referrerPartyId: partyHospId, isUrgent: true },
        testIds: [testXId],
        billing: {},
      });
    expect(res.status).toBe(201);
    expect(res.body.referrerPartyId).toBe(partyHospId);
    expect(res.body.isUrgent).toBe(true);
  });

  // ---------------------------------------------------------------------------
  // §5 discountAuthorizedBy — always set from JWT when discount > 0
  // ---------------------------------------------------------------------------

  it('order with discountPercent > 0 always records discountAuthorizedBy from authenticated user', async () => {
    const res = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: { firstName: 'Discount', lastName: 'Audit', gender: 'female', mobile: '9700000004', dob: '1992-07-10' },
        orderDetails: { isUrgent: false },
        testIds: [testXId],
        billing: { discountPercent: 10 },
      });
    expect(res.status).toBe(201);
    expect(Number(res.body.discountPercent)).toBe(10);

    // Verify the discountAuthorizedBy was set server-side from the JWT
    const orderRow = await plain.order.findUnique({ where: { id: res.body.id } });
    expect(orderRow).not.toBeNull();
    expect(orderRow!.discountAuthorizedBy).toBe(adminUserId);
  });

  it('order with discountPercent = 0 has discountAuthorizedBy = null', async () => {
    const res = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: { firstName: 'NoDiscount', lastName: 'Patient', gender: 'male', mobile: '9700000005', dob: '1985-12-01' },
        orderDetails: { isUrgent: false },
        testIds: [testXId],
        billing: { discountPercent: 0 },
      });
    expect(res.status).toBe(201);
    const orderRow = await plain.order.findUnique({ where: { id: res.body.id } });
    expect(orderRow!.discountAuthorizedBy).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // §6 discountAuthorizedBy cannot be spoofed by the client
  // ---------------------------------------------------------------------------

  it('client-supplied discountAuthorizedBy is rejected by forbidNonWhitelisted (400) — never reaches order creation', async () => {
    const countBefore = await plain.order.count();
    const res = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: { firstName: 'Spoof', lastName: 'Attempt', gender: 'male', mobile: '9700000006', dob: '1990-04-05' },
        orderDetails: { isUrgent: false },
        testIds: [testXId],
        billing: { discountPercent: 5 },
        // Attempt to spoof — this field is NOT in the DTO, so forbidNonWhitelisted rejects it
        discountAuthorizedBy: 'fake-user-id',
      });
    expect(res.status).toBe(400);
    const countAfter = await plain.order.count();
    expect(countAfter).toBe(countBefore); // no order created
  });

  // ---------------------------------------------------------------------------
  // §7 expectedReportDate — captured when provided
  // ---------------------------------------------------------------------------

  it('order with expectedReportDate stores the date correctly', async () => {
    const targetDate = '2026-08-25T00:00:00.000Z';
    const res = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: { firstName: 'ReportDate', lastName: 'Patient', gender: 'female', mobile: '9700000007', dob: '1998-09-12' },
        orderDetails: { isUrgent: false, expectedReportDate: targetDate },
        testIds: [testXId],
        billing: {},
      });
    expect(res.status).toBe(201);
    const orderRow = await plain.order.findUnique({ where: { id: res.body.id } });
    expect(orderRow).not.toBeNull();
    expect(orderRow!.expectedReportDate).not.toBeNull();
    expect(orderRow!.expectedReportDate!.toISOString().slice(0, 10)).toBe('2026-08-25');
  });

  it('order without expectedReportDate stores null', async () => {
    const res = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: { firstName: 'NoDate', lastName: 'Patient', gender: 'male', mobile: '9700000008', dob: '1993-11-20' },
        orderDetails: { isUrgent: false },
        testIds: [testXId],
        billing: {},
      });
    expect(res.status).toBe(201);
    const orderRow = await plain.order.findUnique({ where: { id: res.body.id } });
    expect(orderRow!.expectedReportDate).toBeNull();
  });
});
