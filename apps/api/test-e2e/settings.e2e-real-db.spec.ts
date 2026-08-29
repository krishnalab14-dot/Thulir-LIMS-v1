import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { bearer, loginAdmin } from './test-helpers';

/**
 * REAL-DATABASE settings suite — verifies org letterhead CRUD and
 * its integration into the Report letterhead rendering.
 *
 * Scenarios:
 *  1. GET /settings/organization returns current (initially blank) settings
 *  2. PUT /settings/organization saves all fields → GET returns them
 *  3. GET /orders/:id/report → lab section reflects saved settings
 *  4. Clearing fields → GET returns nulls, letterhead degrades gracefully
 *  5. Non-admin role (technician) → PUT rejected with 403
 *  6. Validation: invalid email → 400
 */
describe('Settings real-DB verification — org letterhead', () => {
  let app: INestApplication;
  const plain = new PrismaClient();
  let authHeaders: Record<string, string>;
  let technicianHeaders: Record<string, string>;
  let orgId: string;
  let testOrderId: string;

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

    // Get org ID from /auth/me
    const me = await http().get('/api/auth/me').set(authHeaders);
    expect(me.status).toBe(200);
    orgId = me.body.organizationId;

    // Create a technician for role-gating test
    await http()
      .post('/api/users')
      .set(authHeaders)
      .send({ username: `tech_settings_${Date.now()}`, password: 'Tech@1234', role: Role.technician });
    // Login the technician
    const techLogin = await http()
      .post('/api/auth/login')
      .send({ username: (await http().get('/api/users').set(authHeaders)).body.find((u: { role: string }) => u.role === 'technician')?.username ?? `tech_settings_${Date.now()}`, password: 'Tech@1234' });
    // Fallback: if the tech login didn't work, create one fresh and login
    if (techLogin.status !== 201) {
      const techUsername = `tech_set_${Date.now()}`;
      const created = await http().post('/api/users').set(authHeaders).send({ username: techUsername, password: 'Tech@1234', role: Role.technician });
      expect(created.status).toBe(201);
      const login = await http().post('/api/auth/login').send({ username: techUsername, password: 'Tech@1234' });
      expect(login.status).toBe(201);
      technicianHeaders = bearer(login.body.accessToken);
    } else {
      technicianHeaders = bearer(techLogin.body.accessToken);
    }

    // Create a fully-approved order for the report test
    // We need to create a test, order it, enter results, verify, approve
    const st = await http().post('/api/masters/sample-types').set(authHeaders).send({ name: 'Serum' });
    const sampleTypeId = st.body.id;

    const testRes = await http().post('/api/masters/tests').set(authHeaders).send({
      testCode: 'SET-01',
      testName: 'Settings Test Glucose',
      currentPrice: 200,
      requiredSampleTypeId: sampleTypeId,
      resultType: 'numeric',
      defaultRefLow: 70,
      defaultRefHigh: 99,
    });
    expect(testRes.status).toBe(201);
    const testId = testRes.body.id;

    const orderRes = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: { firstName: 'Settings', lastName: 'Test', gender: 'male', mobile: '9800000001', dob: '1990-01-01' },
        testIds: [testId],
        billing: {},
      });
    expect(orderRes.status).toBe(201);
    testOrderId = orderRes.body.id;

    // Collect sample (required before result entry)
    const sample = await plain.sample.findFirst({ where: { orderId: testOrderId } });
    expect(sample).not.toBeNull();
    await http().put(`/api/samples/${sample!.id}/collect`).set(authHeaders).expect(200);

    // Enter result
    const otId = orderRes.body.orderTests[0].id;
    await http().put(`/api/orders/${testOrderId}/results`).set(authHeaders).send({
      entries: [{ orderTestId: otId, resultValue: '85' }],
    });

    // Verify
    await http().put(`/api/orders/${testOrderId}/verify`).set(authHeaders).send({
      orderTestIds: [otId],
    });

    // Approve
    await http().put(`/api/orders/${testOrderId}/approve`).set(authHeaders).send({
      orderTestIds: [otId],
    });
  });

  afterAll(async () => {
    // Reset org settings so other test suites aren't affected
    await plain.organization.update({
      where: { id: orgId },
      data: { address: null, phone: null, email: null, nablAccreditationNumber: null, gstNumber: null, logoUrl: null },
    });
    await app.close();
    await plain.$disconnect();
  });

  it('GET /settings/organization returns current org settings (initially blank printable fields)', async () => {
    const res = await http().get('/api/settings/organization').set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.name).toBeDefined();
    expect(res.body.id).toBe(orgId);
    // Initially blank — these fields were just added
    expect(res.body.address).toBeFalsy();
    expect(res.body.phone).toBeFalsy();
  });

  it('PUT /settings/organization saves all fields → GET returns them', async () => {
    const updateRes = await http()
      .put('/api/settings/organization')
      .set(authHeaders)
      .send({
        address: '123 Health Lane, Chennai 600001',
        phone: '+91-44-23456789',
        email: 'lab@test.com',
        nablAccreditationNumber: 'TC-9999',
        gstNumber: '33AAAAA0000A1Z5',
        logoUrl: 'https://example.com/logo.png',
      });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.address).toBe('123 Health Lane, Chennai 600001');
    expect(updateRes.body.phone).toBe('+91-44-23456789');
    expect(updateRes.body.email).toBe('lab@test.com');
    expect(updateRes.body.nablAccreditationNumber).toBe('TC-9999');
    expect(updateRes.body.gstNumber).toBe('33AAAAA0000A1Z5');
    expect(updateRes.body.logoUrl).toBe('https://example.com/logo.png');

    // GET confirms
    const getRes = await http().get('/api/settings/organization').set(authHeaders);
    expect(getRes.status).toBe(200);
    expect(getRes.body.address).toBe('123 Health Lane, Chennai 600001');
    expect(getRes.body.nablAccreditationNumber).toBe('TC-9999');
  });

  it('GET /orders/:id/report → lab section reflects saved settings', async () => {
    const res = await http().get(`/api/orders/${testOrderId}/report`).set(authHeaders);
    expect(res.status).toBe(200);
    expect(res.body.lab.labName).toBeDefined();
    expect(res.body.lab.labAddress).toBe('123 Health Lane, Chennai 600001');
    expect(res.body.lab.labPhone).toBe('+91-44-23456789');
    expect(res.body.lab.labEmail).toBe('lab@test.com');
    expect(res.body.lab.nablAccreditationNumber).toBe('TC-9999');
    expect(res.body.lab.logoUrl).toBe('https://example.com/logo.png');
  });

  it('clearing fields → GET returns nulls, letterhead degrades gracefully', async () => {
    await http()
      .put('/api/settings/organization')
      .set(authHeaders)
      .send({
        address: null,
        phone: null,
        email: null,
        nablAccreditationNumber: null,
        logoUrl: null,
      });

    const getRes = await http().get('/api/settings/organization').set(authHeaders);
    expect(getRes.status).toBe(200);
    expect(getRes.body.address).toBeNull();
    expect(getRes.body.phone).toBeNull();
    expect(getRes.body.email).toBeNull();
    expect(getRes.body.nablAccreditationNumber).toBeNull();
    expect(getRes.body.logoUrl).toBeNull();

    // Report still works — lab section has nulls, no crash
    const reportRes = await http().get(`/api/orders/${testOrderId}/report`).set(authHeaders);
    expect(reportRes.status).toBe(200);
    expect(reportRes.body.lab.labName).toBeDefined();
    expect(reportRes.body.lab.labAddress).toBeNull();
    expect(reportRes.body.lab.labPhone).toBeNull();
  });

  it('non-admin role (technician) attempting to update settings → 403', async () => {
    const res = await http()
      .put('/api/settings/organization')
      .set(technicianHeaders)
      .send({ address: 'Hacker address' });
    expect(res.status).toBe(403);
  });

  it('validation: invalid email → 400', async () => {
    const res = await http()
      .put('/api/settings/organization')
      .set(authHeaders)
      .send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
  });
});
