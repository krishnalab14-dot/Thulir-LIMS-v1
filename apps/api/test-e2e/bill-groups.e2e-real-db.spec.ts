import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { bearer, loginAdmin } from './test-helpers';

/**
 * Consolidated Billing (BillGroup) integration suite — create group,
 * link/unlink orders, verify cross-order billing visibility.
 *
 * Runs via `npm run verify:real-db` against real Postgres.
 */
describe('Consolidated Billing — BillGroup (real-DB)', () => {
  let app: INestApplication;
  const plain = new PrismaClient();
  let authHeaders: Record<string, string>;

  let testAId: string;
  let testBId: string;

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

    // Clean slate for order/payment tables
    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Order", "BillGroup", "Patient", "UidCounter" CASCADE`,
    );

    // Create two standalone tests
    const a = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({ testCode: 'E2E-BGA', testName: 'BillGroup Test A', currentPrice: 300, defaultRefLow: 0, defaultRefHigh: 100 });
    expect(a.status).toBe(201);
    testAId = a.body.id;

    const b = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({ testCode: 'E2E-BGB', testName: 'BillGroup Test B', currentPrice: 500, defaultRefLow: 0, defaultRefHigh: 150 });
    expect(b.status).toBe(201);
    testBId = b.body.id;
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  function createOrder(label: string, testIds: string[]) {
    return http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: {
          firstName: `BillGroup`,
          lastName: label,
          gender: 'female',
          mobile: `90000${Math.floor(Math.random() * 100000)}`,
          dob: '1990-01-01',
        },
        orderDetails: {},
        testIds,
        billing: {},
        payment: {},
      });
  }

  // -----------------------------------------------------------------------
  // Tests
  // -----------------------------------------------------------------------

  it('POST /api/bill-groups creates a new BillGroup', async () => {
    const res = await http().post('/api/bill-groups').set(authHeaders).send({});
    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
  });

  it('GET /api/bill-groups/:id returns 404 for non-existent group', async () => {
    const res = await http().get('/api/bill-groups/nonexistent_id').set(authHeaders);
    expect(res.status).toBe(404);
  });

  it('PATCH /api/bill-groups/:id/orders/:orderId links an order and returns it in the group', async () => {
    // Create a bill group
    const group = await http().post('/api/bill-groups').set(authHeaders).send({});
    expect(group.status).toBe(201);
    const groupId = group.body.id;

    // Create two orders
    const order1 = await createOrder('Alpha', [testAId]);
    expect(order1.status).toBe(201);
    const order1Id = order1.body.id;

    const order2 = await createOrder('Beta', [testBId]);
    expect(order2.status).toBe(201);
    const order2Id = order2.body.id;

    // Link first order
    const link1 = await http()
      .patch(`/api/bill-groups/${groupId}/orders/${order1Id}`)
      .set(authHeaders)
      .send({});
    expect(link1.status).toBe(200);
    expect(link1.body.linked).toBe(true);

    // Link second order
    const link2 = await http()
      .patch(`/api/bill-groups/${groupId}/orders/${order2Id}`)
      .set(authHeaders)
      .send({});
    expect(link2.status).toBe(200);
    expect(link2.body.linked).toBe(true);

    // Fetch the group — should contain both orders
    const fetched = await http().get(`/api/bill-groups/${groupId}`).set(authHeaders);
    expect(fetched.status).toBe(200);
    expect(fetched.body.orders).toHaveLength(2);
    expect(fetched.body.orders.map((o: { id: string }) => o.id).sort()).toEqual([order1Id, order2Id].sort());
  });

  it('PATCH /api/bill-groups/:id/orders/:orderId returns 404 for non-existent group', async () => {
    const order = await createOrder('Gamma', [testAId]);
    expect(order.status).toBe(201);

    const res = await http()
      .patch(`/api/bill-groups/nonexistent/orders/${order.body.id}`)
      .set(authHeaders)
      .send({});
    expect(res.status).toBe(404);
  });

  it('PATCH /api/bill-groups/:id/orders/:orderId/unlink removes an order from the group', async () => {
    const group = await http().post('/api/bill-groups').set(authHeaders).send({});
    const groupId = group.body.id;

    const order = await createOrder('Delta', [testAId]);
    const orderId = order.body.id;

    // Link
    await http().patch(`/api/bill-groups/${groupId}/orders/${orderId}`).set(authHeaders).send({});

    // Unlink
    const unlink = await http()
      .patch(`/api/bill-groups/${groupId}/orders/${orderId}/unlink`)
      .set(authHeaders)
      .send({});
    expect(unlink.status).toBe(200);
    expect(unlink.body.unlinked).toBe(true);

    // Group should now have 0 orders
    const fetched = await http().get(`/api/bill-groups/${groupId}`).set(authHeaders);
    expect(fetched.status).toBe(200);
    expect(fetched.body.orders).toHaveLength(0);

    // Order should have null billGroupId in DB
    const dbOrder = await plain.order.findUnique({ where: { id: orderId } });
    expect(dbOrder?.billGroupId).toBeNull();
  });

  it('unlink returns 404 when order is not in the specified group', async () => {
    const groupA = await http().post('/api/bill-groups').set(authHeaders).send({});
    const groupB = await http().post('/api/bill-groups').set(authHeaders).send({});

    const order = await createOrder('Epsilon', [testAId]);
    const orderId = order.body.id;

    // Link to groupA
    await http().patch(`/api/bill-groups/${groupA.body.id}/orders/${orderId}`).set(authHeaders).send({});

    // Try to unlink from groupB — should 404
    const unlink = await http()
      .patch(`/api/bill-groups/${groupB.body.id}/orders/${orderId}/unlink`)
      .set(authHeaders)
      .send({});
    expect(unlink.status).toBe(404);
  });

  it('Order.billGroupId is null by default for standalone orders', async () => {
    const order = await createOrder('Zeta', [testAId]);
    expect(order.status).toBe(201);
    expect(order.body.billGroupId).toBeNull();
  });

  it('Creating an order with billGroupId in DTO is accepted', async () => {
    const group = await http().post('/api/bill-groups').set(authHeaders).send({});
    const groupId = group.body.id;

    const res = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: {
          firstName: 'BillGroup',
          lastName: 'Eta',
          gender: 'male',
          mobile: '9000099999',
          dob: '1992-03-20',
        },
        orderDetails: { billGroupId: groupId },
        testIds: [testAId],
        billing: {},
        payment: {},
      });
    expect(res.status).toBe(201);
    expect(res.body.billGroupId).toBe(groupId);
  });
});
