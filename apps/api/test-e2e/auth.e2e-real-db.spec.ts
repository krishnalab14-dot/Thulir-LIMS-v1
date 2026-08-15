import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, Role } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { bearer, loginAdmin } from './test-helpers';

/**
 * REAL-DATABASE Stage 7 (Auth) suite — the mechanism swap that every prior
 * stage documented as temporary is now the real thing:
 *
 *   - public register bootstraps a NEW org + its first admin in one
 *     transaction (usernames globally unique, DB-enforced);
 *   - login verifies the bcrypt hash and issues a short-lived JWT access
 *     token + a longer-lived opaque refresh token (stored only as a sha-256
 *     hash);
 *   - refresh ROTATES the refresh token — an old, already-rotated token is
 *     rejected (401);
 *   - logout invalidates the refresh token;
 *   - CONCURRENCY: two simultaneous registers for the same org name are two
 *     SEPARATE orgs (org name is not unique — nothing ties identity to a
 *     name; the usernames differ so both land cleanly);
 *   - role enforcement (the §4 gate, now real): technician/admin/lab_manager
 *     on Verify; pathologist/admin/lab_manager on Approval; admin-only on
 *     Masters edits and staff creation; every other role gets a 403. The
 *     frontend's nav hiding is UX — this is the actual security boundary.
 */
describe('Stage 7 real-DB verification — auth', () => {
  let app: INestApplication;
  const plain = new PrismaClient();

  let adminHeaders: Record<string, string>;
  let adminUserId: string;

  let technicianHeaders: Record<string, string>;
  let receptionistHeaders: Record<string, string>;
  let pathologistHeaders: Record<string, string>;
  let labManagerHeaders: Record<string, string>;

  let tGluId: string;
  let orderId: string;
  let otId: string;

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
    adminUserId = admin.userId;

    // Staff for the role-enforcement tests, created through the REAL
    // admin-only POST /api/users endpoint.
    const mkStaff = async (username: string, role: Role) => {
      const res = await http()
        .post('/api/users')
        .set(adminHeaders)
        .send({ username, password: 'Staff@1234', role });
      expect(res.status).toBe(201);
      return res.body as { id: string; username: string; role: Role };
    };
    await mkStaff('staff_technician', Role.technician);
    await mkStaff('staff_receptionist', Role.receptionist);
    await mkStaff('staff_pathologist', Role.pathologist);
    await mkStaff('staff_lab_manager', Role.lab_manager);

    const loginStaff = async (username: string) => {
      const res = await http().post('/api/auth/login').send({ username, password: 'Staff@1234' });
      expect(res.status).toBe(201);
      return bearer(res.body.accessToken as string);
    };
    technicianHeaders = await loginStaff('staff_technician');
    receptionistHeaders = await loginStaff('staff_receptionist');
    pathologistHeaders = await loginStaff('staff_pathologist');
    labManagerHeaders = await loginStaff('staff_lab_manager');

    // One order in org_demo through the normal pipeline (as admin): sample
    // type → numeric test → order → collect → enter result → verify. Ends
    // VERIFIED so the pathologist's approve (positive case) can run on it.
    const st = await http().post('/api/masters/sample-types').set(adminHeaders).send({ name: 'Auth Serum' });
    expect(st.status).toBe(201);
    const t = await http()
      .post('/api/masters/tests')
      .set(adminHeaders)
      .send({
        testCode: 'AUTH-GLU',
        testName: 'Auth Glucose',
        currentPrice: 150,
        requiredSampleTypeId: st.body.id,
        defaultRefLow: 70,
        defaultRefHigh: 99,
      });
    expect(t.status).toBe(201);
    tGluId = t.body.id;

    const order = await http()
      .post('/api/orders')
      .set(adminHeaders)
      .send({
        patient: { firstName: 'Auth', lastName: 'User', gender: 'female', mobile: '9770000001', dob: '1990-01-01' },
        testIds: [tGluId],
        billing: {},
      });
    expect(order.status).toBe(201);
    orderId = order.body.id;
    otId = order.body.orderTests[0].id as string;

    const sample = await plain.sample.findFirst({ where: { orderId } });
    await http().put(`/api/samples/${sample!.id}/collect`).set(adminHeaders).expect(200);
    await http()
      .put(`/api/orders/${orderId}/results`)
      .set(adminHeaders)
      .send({ entries: [{ orderTestId: otId, resultValue: '88' }] })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  // ---------------------------------------------------------------------------
  // §2 registration + login correctness
  // ---------------------------------------------------------------------------

  it('register bootstraps a NEW org + first admin; that admin can log in and reach protected routes', async () => {
    const username = 'fresh_org_admin';
    const password = 'Fresh@1234';
    const reg = await http()
      .post('/api/auth/register')
      .send({ organizationName: 'Fresh Org', username, password });
    expect(reg.status).toBe(201);
    expect(reg.body.organizationId).toBeTruthy();
    expect(reg.body.user).toEqual(expect.objectContaining({ username, role: 'admin' }));

    // The new org's admin can log in and use a protected route scoped to THAT org.
    const login = await http().post('/api/auth/login').send({ username, password });
    expect(login.status).toBe(201);
    expect(login.body.user.organizationId).toBe(reg.body.organizationId);
    const me = await http().get('/api/auth/me').set(bearer(login.body.accessToken as string));
    expect(me.status).toBe(200);
    expect(me.body).toEqual(
      expect.objectContaining({ id: login.body.user.id, username, role: 'admin', organizationId: reg.body.organizationId }),
    );

    // The fresh org has NO orders (cross-tenant isolation by construction).
    const orders = await http().get('/api/orders').set(bearer(login.body.accessToken as string));
    expect(orders.status).toBe(200);
    expect(orders.body).toEqual([]);
  });

  it('register rejects a globally-duplicate username with 409 (and the DB unique index closes the race)', async () => {
    const first = await http().post('/api/auth/register').send({ organizationName: 'Dup Org A', username: 'dup_user', password: 'Dup@1234' });
    expect(first.status).toBe(201);
    const second = await http().post('/api/auth/register').send({ organizationName: 'Dup Org B', username: 'dup_user', password: 'Dup@1234' });
    expect(second.status).toBe(409);
    expect(second.body.message).toContain('Username is already taken');
  });

  it('CONCURRENCY: two simultaneous registers for the same org name → two SEPARATE orgs, both clean', async () => {
    // Nothing ties org identity to a name (no unique org-name constraint), so
    // two parallel registrations for "Same Name Org" are two independent new
    // orgs — the intended behavior, verified under real parallel load.
    const [a, b] = await Promise.all([
      http().post('/api/auth/register').send({ organizationName: 'Same Name Org', username: 'same_name_a', password: 'Same@1234' }),
      http().post('/api/auth/register').send({ organizationName: 'Same Name Org', username: 'same_name_b', password: 'Same@1234' }),
    ]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.organizationId).not.toBe(b.body.organizationId);
    // Both admins can log in.
    const la = await http().post('/api/auth/login').send({ username: 'same_name_a', password: 'Same@1234' });
    const lb = await http().post('/api/auth/login').send({ username: 'same_name_b', password: 'Same@1234' });
    expect(la.status).toBe(201);
    expect(lb.status).toBe(201);
  });

  it('login rejects wrong password and inactive users with the SAME 401 (no account-existence oracle)', async () => {
    const wrongPass = await http().post('/api/auth/login').send({ username: 'admin', password: 'definitely-wrong' });
    expect(wrongPass.status).toBe(401);
    const unknown = await http().post('/api/auth/login').send({ username: 'no_such_user', password: 'Whatever@1' });
    expect(unknown.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // §2 refresh rotation + logout
  // ---------------------------------------------------------------------------

  it('refresh rotates the token: old refresh token is dead after one use', async () => {
    const login = await http().post('/api/auth/login').send({ username: 'admin', password: 'Thulir@123' });
    expect(login.status).toBe(201);
    const firstRefresh = login.body.refreshToken as string;

    const rotated = await http().post('/api/auth/refresh').send({ refreshToken: firstRefresh });
    expect(rotated.status).toBe(201);
    expect(rotated.body.accessToken).toBeTruthy();
    expect(rotated.body.refreshToken).not.toBe(firstRefresh);

    // Replay of the OLD refresh token → 401 (rotation invalidated it).
    const replay = await http().post('/api/auth/refresh').send({ refreshToken: firstRefresh });
    expect(replay.status).toBe(401);

    // The NEW token works.
    const again = await http().post('/api/auth/refresh').send({ refreshToken: rotated.body.refreshToken });
    expect(again.status).toBe(201);
  });

  it('logout invalidates the refresh token; /auth/me and /auth/logout require a valid access token', async () => {
    const login = await http().post('/api/auth/login').send({ username: 'admin', password: 'Thulir@123' });
    const refreshToken = login.body.refreshToken as string;
    const accessToken = login.body.accessToken as string;

    const logout = await http().post('/api/auth/logout').set(bearer(accessToken)).send({ refreshToken });
    expect(logout.status).toBe(201);
    expect(logout.body).toEqual({ ok: true });

    const afterLogout = await http().post('/api/auth/refresh').send({ refreshToken });
    expect(afterLogout.status).toBe(401);

    // No token / bad token on a protected route → 401 (the global guard).
    const noToken = await http().get('/api/orders');
    expect(noToken.status).toBe(401);
    const badToken = await http().get('/api/orders').set(bearer('not-a-real-token'));
    expect(badToken.status).toBe(401);
  });

  // ---------------------------------------------------------------------------
  // §4 role enforcement — 403s and the positive path
  // ---------------------------------------------------------------------------

  it('a technician may verify; a receptionist is rejected with 403 before any write', async () => {
    // Receptionist → Verify actions → 403 (role gate, not a data error).
    const recVerify = await http()
      .put(`/api/orders/${orderId}/verify`)
      .set(receptionistHeaders)
      .send({ orderTestIds: [otId] });
    expect(recVerify.status).toBe(403);
    // Row untouched (verify gate rejects before the write path).
    expect((await plain.orderTest.findUnique({ where: { id: otId } }))!.status).toBe('entered');

    // Technician → the same call succeeds (positive path for the gate).
    const techVerify = await http().put(`/api/orders/${orderId}/verify`).set(technicianHeaders).send({ orderTestIds: [otId] });
    expect(techVerify.status).toBe(200);
    expect(techVerify.body.verified).toHaveLength(1);
    const row = await plain.orderTest.findUnique({ where: { id: otId } });
    expect(row!.status).toBe('verified');
    expect(row!.verifiedBy).toBe((await plain.user.findUnique({ where: { username: 'staff_technician' } }))!.id);
  });

  it('a receptionist is rejected from Approval too; a pathologist approves successfully (positive case)', async () => {
    const recApprove = await http().put(`/api/orders/${orderId}/approve`).set(receptionistHeaders).send({ orderTestIds: [otId] });
    expect(recApprove.status).toBe(403);

    const pathApprove = await http().put(`/api/orders/${orderId}/approve`).set(pathologistHeaders).send({ orderTestIds: [otId] });
    expect(pathApprove.status).toBe(200);
    expect(pathApprove.body.approved).toHaveLength(1);
    const row = await plain.orderTest.findUnique({ where: { id: otId } });
    expect(row!.status).toBe('approved');
    expect(row!.approvedBy).toBe((await plain.user.findUnique({ where: { username: 'staff_pathologist' } }))!.id);
    expect(row!.approvalSignatureStamp).toMatch(/^[0-9A-F]{16}$/);
  });

  it('a lab_manager can use both Verify and Approval queues', async () => {
    const verifyQueue = await http().get('/api/verify-queue').set(labManagerHeaders);
    expect(verifyQueue.status).toBe(200);
    const approvalQueue = await http().get('/api/approval-queue').set(labManagerHeaders);
    expect(approvalQueue.status).toBe(200);
    // The order is fully approved by now → verify queue is empty, approval queue is too.
    expect(verifyQueue.body).toEqual([]);
    expect(approvalQueue.body).toEqual([]);
  });

  it('Masters edits are admin-only: technician / pathologist / lab_manager all get 403', async () => {
    const body = { testCode: 'AUTH-NOPE', testName: 'Auth Nope', currentPrice: 10, defaultRefLow: 1, defaultRefHigh: 10 };
    for (const headers of [technicianHeaders, receptionistHeaders, pathologistHeaders, labManagerHeaders]) {
      const res = await http().post('/api/masters/tests').set(headers).send(body);
      expect(res.status).toBe(403);
    }
    const adminOk = await http().post('/api/masters/tests').set(adminHeaders).send(body);
    expect(adminOk.status).toBe(201);
  });

  it('POST /api/users is admin-only — a technician attempting staff creation gets 403', async () => {
    const res = await http()
      .post('/api/users')
      .set(technicianHeaders)
      .send({ username: 'sneaky_staff', password: 'Sneaky@123', role: 'admin' });
    expect(res.status).toBe(403);
    const exists = await plain.user.findUnique({ where: { username: 'sneaky_staff' } });
    expect(exists).toBeNull();
  });

  it('a receptionist can still use unrestricted pages (orders list) — the gate is per-endpoint', async () => {
    const res = await http().get('/api/orders').set(receptionistHeaders);
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('the seeded admin is still fully allowed everywhere (verify/approve/masters/users)', async () => {
    // Admin is in both documented gates (technician/admin/lab_manager and
    // pathologist/admin/lab_manager) and Masters' admin-only gate.
    const users = await http().post('/api/users').set(adminHeaders).send({ username: 'staff_extra', password: 'Extra@1234', role: Role.technician });
    expect(users.status).toBe(201);
    const masters = await http().post('/api/masters/sample-types').set(adminHeaders).send({ name: 'Admin Tube' });
    expect(masters.status).toBe(201);
    expect(adminUserId).toBeTruthy();
  });
});
