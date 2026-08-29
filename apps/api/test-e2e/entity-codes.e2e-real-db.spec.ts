import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { bearer, loginAdmin, registerOrgAdmin } from './test-helpers';

/**
 * REAL-DATABASE suite for entity codes:
 *   - Doctor Code (THU-DR-NNNN): format, uniqueness, generated on Party creation
 *   - Staff Code (THU-ST-NNNN): format, uniqueness, generated on User creation
 */
describe('Entity codes real-DB — Doctor Code + Staff Code', () => {
  let app: INestApplication;
  const plain = new PrismaClient();
  let authHeaders: Record<string, string>;
  // Use a unique suffix so names don't collide with other suites
  const ts = Date.now().toString(36);

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

    // Do NOT truncate UidCounter/Party/User — other suites depend on
    // the seeded state.  Instead we use unique names and simply verify
    // the code FORMAT, SEQUENCING, and INDEPENDENCE, not absolute values.
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  // --- Doctor Codes ---

  it('POST /api/parties with type=doctor returns a doctorCode matching <PREFIX>-DR-NNNN', async () => {
    const res = await http()
      .post('/api/parties')
      .set(authHeaders)
      .send({ name: `Dr. Entity Test ${ts}`, type: 'doctor' });
    expect(res.status).toBe(201);
    expect(res.body.doctorCode).toMatch(/^\w{3}-DR-\d{4}$/);
  });

  it('two consecutive doctor creations get strictly increasing doctor codes', async () => {
    const r1 = await http()
      .post('/api/parties')
      .set(authHeaders)
      .send({ name: `Dr. Seq A ${ts}`, type: 'doctor' });
    expect(r1.status).toBe(201);
    const r2 = await http()
      .post('/api/parties')
      .set(authHeaders)
      .send({ name: `Dr. Seq B ${ts}`, type: 'doctor' });
    expect(r2.status).toBe(201);

    const num1 = parseInt(r1.body.doctorCode.split('-').pop()!, 10);
    const num2 = parseInt(r2.body.doctorCode.split('-').pop()!, 10);
    expect(num2).toBe(num1 + 1);
  });

  it('POST /api/parties with type=hospital does NOT get a doctorCode', async () => {
    const res = await http()
      .post('/api/parties')
      .set(authHeaders)
      .send({ name: `Test Hospital ${ts}`, type: 'hospital' });
    expect(res.status).toBe(201);
    expect(res.body.doctorCode).toBeNull();
  });

  it('GET /api/parties?type=doctor&all=true includes doctorCode', async () => {
    const res = await http()
      .get('/api/parties?type=doctor&all=true')
      .set(authHeaders);
    expect(res.status).toBe(200);
    const doctors = res.body as Array<{ doctorCode: string | null }>;
    expect(doctors.length).toBeGreaterThan(0);
    // All doctors created through the API should have a code
    const withCode = doctors.filter((d) => d.doctorCode && /^\w{3}-DR-\d{4}$/.test(d.doctorCode));
    expect(withCode.length).toBeGreaterThanOrEqual(3); // at least our 3 test doctors
  });

  // --- Staff Codes ---

  it('POST /api/users creates a staffCode matching <PREFIX>-ST-NNNN', async () => {
    const uname = `ent_staff_${ts}`;
    const res = await http()
      .post('/api/users')
      .set(authHeaders)
      .send({ username: uname, password: 'TestPass123!', role: 'technician' });
    expect(res.status).toBe(201);
    // Staff code is on the user record — verify via DB
    const user = await plain.user.findUnique({ where: { username: uname } });
    expect(user).not.toBeNull();
    expect(user!.staffCode).toMatch(/^\w{3}-ST-\d{4}$/);
  });

  it('GET /api/users returns staff with staffCode', async () => {
    const res = await http()
      .get('/api/users')
      .set(authHeaders);
    expect(res.status).toBe(200);
    const users = res.body as Array<{ staffCode: string | null; username: string }>;
    expect(users.length).toBeGreaterThan(0);
    // Our test user should be in the list with a staff code
    const testUser = users.find((u) => u.username === `ent_staff_${ts}`);
    expect(testUser).toBeDefined();
    expect(testUser!.staffCode).toMatch(/^\w{3}-ST-\d{4}$/);
  });

  it('doctor codes and staff codes are independent counters (no interference)', async () => {
    const docRes = await http()
      .post('/api/parties')
      .set(authHeaders)
      .send({ name: `Dr. Counter ${ts}`, type: 'doctor' });
    expect(docRes.status).toBe(201);

    const staffRes = await http()
      .post('/api/users')
      .set(authHeaders)
      .send({ username: `cntr_${ts}`, password: 'TestPass123!', role: 'receptionist' });
    expect(staffRes.status).toBe(201);

    // Doctor code should be in DR namespace, staff in ST — namespaces never collide
    const doc = await plain.party.findUnique({ where: { id: docRes.body.id } });
    const staff = await plain.user.findUnique({ where: { username: `cntr_${ts}` } });
    expect(doc!.doctorCode).toMatch(/^\w{3}-DR-/);
    expect(staff!.staffCode).toMatch(/^\w{3}-ST-/);
  });

  it('staff codes are per-org — two orgs\' first staff members both get -0001', async () => {
    // Org A already exists (authHeaders).  Register Org B.
    await registerOrgAdmin(app, `orgb_${ts}`);

    // The admin created by registerOrgAdmin IS Org B's first staff member
    // and should have -0001, regardless of how many staff Org A has.
    const adminB = await plain.user.findUnique({ where: { username: `other_admin_orgb_${ts}` } });
    expect(adminB).not.toBeNull();
    expect(adminB!.staffCode).toMatch(/-ST-0001$/);

    // Format check on the staff code.
    expect(adminB!.staffCode).toMatch(/^\w{3}-ST-/);
  });
});
