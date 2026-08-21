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

  // -----------------------------------------------------------------------
  // §1 Combined totals
  // -----------------------------------------------------------------------

  describe('Combined totals — GET /api/bill-groups/:id', () => {
    it('returns correct combined total for 2 orders (testA=300, testB=500)', async () => {
      const group = await http().post('/api/bill-groups').set(authHeaders).send({});
      const groupId = group.body.id;

      const order1 = await createOrder('CT-Alpha', [testAId]); // 300
      expect(order1.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order1.body.id}`).set(authHeaders).send({});

      const order2 = await createOrder('CT-Beta', [testBId]); // 500
      expect(order2.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order2.body.id}`).set(authHeaders).send({});

      const fetched = await http().get(`/api/bill-groups/${groupId}`).set(authHeaders);
      expect(fetched.status).toBe(200);
      expect(fetched.body.combinedTotal).toBe(800);
      expect(fetched.body.combinedPaid).toBe(0);
      expect(fetched.body.combinedOutstanding).toBe(800);
      expect(fetched.body.orders).toHaveLength(2);

      // Each order should have paid/outstanding fields on its invoice
      for (const order of fetched.body.orders) {
        expect(order.invoice).toBeDefined();
        expect(order.invoice.paid).toBe(0);
        expect(order.invoice.outstanding).toBe(Number(order.invoice.totalAmount));
      }
    });

    it('combined totals update after a per-order payment via invoices endpoint', async () => {
      const group = await http().post('/api/bill-groups').set(authHeaders).send({});
      const groupId = group.body.id;

      const order1 = await createOrder('CT2-Alpha', [testAId]); // 300
      expect(order1.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order1.body.id}`).set(authHeaders).send({});

      const order2 = await createOrder('CT2-Beta', [testBId]); // 500
      expect(order2.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order2.body.id}`).set(authHeaders).send({});

      // Pay 100 against order1's invoice directly
      const invoiceId = order1.body.invoice.id;
      const payRes = await http()
        .post(`/api/invoices/${invoiceId}/payments`)
        .set(authHeaders)
        .send({ splits: [{ mode: 'cash', amount: 100 }] });
      expect(payRes.status).toBe(201);

      const fetched = await http().get(`/api/bill-groups/${groupId}`).set(authHeaders);
      expect(fetched.status).toBe(200);
      expect(fetched.body.combinedTotal).toBe(800);
      expect(fetched.body.combinedPaid).toBe(100);
      expect(fetched.body.combinedOutstanding).toBe(700);
    });
  });

  // -----------------------------------------------------------------------
  // §2 Payment distribution — POST /api/bill-groups/:id/payments
  // -----------------------------------------------------------------------

  describe('Payment distribution — POST /api/bill-groups/:id/payments', () => {
    it('partial payment splits correctly across 2 orders', async () => {
      const group = await http().post('/api/bill-groups').set(authHeaders).send({});
      const groupId = group.body.id;

      const order1 = await createOrder('PD-Alpha', [testAId]); // 300
      expect(order1.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order1.body.id}`).set(authHeaders).send({});

      const order2 = await createOrder('PD-Beta', [testBId]); // 500
      expect(order2.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order2.body.id}`).set(authHeaders).send({});

      // Pay ₹400 (₹300 goes to order1, ₹100 goes to order2)
      const payRes = await http()
        .post(`/api/bill-groups/${groupId}/payments`)
        .set(authHeaders)
        .send({ splits: [{ mode: 'cash', amount: 400 }] });
      expect(payRes.status).toBe(201);
      expect(payRes.body.totalPaid).toBe(400);
      expect(payRes.body.distribution).toHaveLength(2);
      expect(payRes.body.distribution[0].distributed).toBe(300);
      expect(payRes.body.distribution[0].newStatus).toBe('paid');
      expect(payRes.body.distribution[1].distributed).toBe(100);
      expect(payRes.body.distribution[1].newStatus).toBe('partial');

      // Verify via GET
      const fetched = await http().get(`/api/bill-groups/${groupId}`).set(authHeaders);
      expect(fetched.body.combinedPaid).toBe(400);
      expect(fetched.body.combinedOutstanding).toBe(400);
    });

    it('full payment across 2 orders (exact total)', async () => {
      const group = await http().post('/api/bill-groups').set(authHeaders).send({});
      const groupId = group.body.id;

      const order1 = await createOrder('PD2-Alpha', [testAId]); // 300
      expect(order1.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order1.body.id}`).set(authHeaders).send({});

      const order2 = await createOrder('PD2-Beta', [testBId]); // 500
      expect(order2.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order2.body.id}`).set(authHeaders).send({});

      // Pay ₹800 (full balance — ₹300 + ₹500)
      const payRes = await http()
        .post(`/api/bill-groups/${groupId}/payments`)
        .set(authHeaders)
        .send({ splits: [{ mode: 'cash', amount: 800 }] });
      expect(payRes.status).toBe(201);
      expect(payRes.body.totalPaid).toBe(800);
      expect(payRes.body.distribution).toHaveLength(2);
      expect(payRes.body.distribution[0].newStatus).toBe('paid');
      expect(payRes.body.distribution[1].newStatus).toBe('paid');

      const fetched = await http().get(`/api/bill-groups/${groupId}`).set(authHeaders);
      expect(fetched.body.combinedPaid).toBe(800);
      expect(fetched.body.combinedOutstanding).toBe(0);
    });

    it('multi-mode split distributes proportionally', async () => {
      const group = await http().post('/api/bill-groups').set(authHeaders).send({});
      const groupId = group.body.id;

      const order1 = await createOrder('PD3-Alpha', [testAId]); // 300
      expect(order1.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order1.body.id}`).set(authHeaders).send({});

      const order2 = await createOrder('PD3-Beta', [testBId]); // 500
      expect(order2.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order2.body.id}`).set(authHeaders).send({});

      // Pay ₹400 with ₹300 cash + ₹100 UPI
      const payRes = await http()
        .post(`/api/bill-groups/${groupId}/payments`)
        .set(authHeaders)
        .send({ splits: [{ mode: 'cash', amount: 300 }, { mode: 'upi', amount: 100 }] });
      expect(payRes.status).toBe(201);
      expect(payRes.body.totalPaid).toBe(400);

      // Verify per-order payment splits exist
      const fetched = await http().get(`/api/bill-groups/${groupId}`).set(authHeaders);
      expect(fetched.body.combinedPaid).toBe(400);
    });

    it('rejects payment exceeding group outstanding balance', async () => {
      const group = await http().post('/api/bill-groups').set(authHeaders).send({});
      const groupId = group.body.id;

      const order1 = await createOrder('PD4-Alpha', [testAId]); // 300
      expect(order1.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${order1.body.id}`).set(authHeaders).send({});

      // Try to pay ₹500 against a ₹300 group
      const payRes = await http()
        .post(`/api/bill-groups/${groupId}/payments`)
        .set(authHeaders)
        .send({ splits: [{ mode: 'cash', amount: 500 }] });
      expect(payRes.status).toBe(400);
    });

    it('rejects payment on empty group (no linked orders)', async () => {
      const group = await http().post('/api/bill-groups').set(authHeaders).send({});
      const groupId = group.body.id;

      const payRes = await http()
        .post(`/api/bill-groups/${groupId}/payments`)
        .set(authHeaders)
        .send({ splits: [{ mode: 'cash', amount: 100 }] });
      expect(payRes.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // §3 Ungrouped order isolation
  // -----------------------------------------------------------------------

  describe('Ungrouped order isolation', () => {
    it('payment against a group does not affect an ungrouped order', async () => {
      const group = await http().post('/api/bill-groups').set(authHeaders).send({});
      const groupId = group.body.id;

      const groupedOrder = await createOrder('ISO-Grouped', [testAId]); // 300
      expect(groupedOrder.status).toBe(201);
      await http().patch(`/api/bill-groups/${groupId}/orders/${groupedOrder.body.id}`).set(authHeaders).send({});

      const ungroupedOrder = await createOrder('ISO-Ungrouped', [testBId]); // 500
      expect(ungroupedOrder.status).toBe(201);
      // intentionally NOT linked to any bill group

      // Pay the full group balance (300)
      const payRes = await http()
        .post(`/api/bill-groups/${groupId}/payments`)
        .set(authHeaders)
        .send({ splits: [{ mode: 'cash', amount: 300 }] });
      expect(payRes.status).toBe(201);

      // Verify: grouped order is paid
      const groupedFetched = await http().get(`/api/bill-groups/${groupId}`).set(authHeaders);
      expect(groupedFetched.body.combinedPaid).toBe(300);
      expect(groupedFetched.body.combinedOutstanding).toBe(0);

      // Verify: ungrouped order's invoice is still fully due
      const ungroupedInvoice = await plain.invoice.findFirst({
        where: { orderId: ungroupedOrder.body.id },
      });
      expect(ungroupedInvoice).toBeDefined();
      expect(ungroupedInvoice!.status).toBe('due');

      // Verify: no payments exist for the ungrouped order's invoice
      const ungroupedPayments = await plain.payment.findMany({
        where: { invoiceId: ungroupedInvoice!.id },
      });
      expect(ungroupedPayments).toHaveLength(0);
    });

    it('ungrouped order does not appear in any bill group', async () => {
      const group = await http().post('/api/bill-groups').set(authHeaders).send({});
      const groupId = group.body.id;

      const order = await createOrder('ISO2-Standalone', [testAId]);
      expect(order.status).toBe(201);
      // Not linked to any group

      const fetched = await http().get(`/api/bill-groups/${groupId}`).set(authHeaders);
      expect(fetched.status).toBe(200);
      expect(fetched.body.orders).toHaveLength(0);
    });
  });
});
