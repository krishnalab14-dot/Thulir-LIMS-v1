import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { bearer, loginAdmin } from './test-helpers';

/**
 * REAL-DATABASE suite for the sequential Bill No. (THU-BILL-YYYY-NNNN).
 *
 * Verifies:
 *   - every new order gets a billNo matching <PREFIX>-BILL-<YEAR>-<NNNN>;
 *   - two consecutive orders get strictly increasing (sequential) numbers;
 *   - bill numbers are unique across orders;
 *   - the bill counter is a SEPARATE namespace from patientUid — creating an
 *     order does not advance the PID sequence and vice versa;
 *   - billing amounts are untouched by bill-number generation.
 */
describe('Bill No. real-DB verification — sequential order bill references', () => {
  let app: INestApplication;
  const plain = new PrismaClient();
  let authHeaders: Record<string, string>;

  let order1: { id: string; billNo: string; totalAmount: string };
  let order2: { id: string; billNo: string; totalAmount: string };

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

    // Fresh counters + orders so the sequence assertions below are deterministic.
    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Sample", "Order", "Patient", "UidCounter" CASCADE`,
    );

    // A minimal order needs at least one test — create one cheap EDTA test.
    const st = await http().post('/api/masters/sample-types').set(authHeaders).send({ name: 'EDTA Tube' });
    expect(st.status).toBe(201);
    const t = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({
        testCode: 'BILL-T',
        testName: 'Bill No Test',
        currentPrice: 100,
        requiredSampleTypeId: st.body.id,
        defaultRefLow: 1,
        defaultRefHigh: 100,
      });
    expect(t.status).toBe(201);
    const testId = t.body.id as string;

    const mkOrder = async (mobile: string) => {
      const res = await http()
        .post('/api/orders')
        .set(authHeaders)
        .send({
          patient: { firstName: 'Bill', lastName: 'No', gender: 'male', mobile, dob: '1990-01-01' },
          testIds: [testId],
          billing: {},
        });
      expect(res.status).toBe(201);
      return res.body as { id: string; billNo: string; totalAmount: string };
    };

    order1 = await mkOrder('9340000001');
    order2 = await mkOrder('9340000002');
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  it('every new order carries a THU-BILL-YYYY-NNNN bill number', () => {
    for (const o of [order1, order2]) {
      expect(o.billNo).toMatch(/^THU-BILL-\d{4}-\d{4}$/);
    }
  });

  it('bill numbers are sequential across consecutive orders and globally unique', async () => {
    const n1 = Number(order1.billNo.split('-').pop());
    const n2 = Number(order2.billNo.split('-').pop());
    expect(n2).toBe(n1 + 1);

    const count = await plain.order.count();
    const distinct = await plain.order.findMany({ select: { billNo: true }, where: { billNo: { not: null } } });
    expect(distinct).toHaveLength(count);
    expect(new Set(distinct.map((d) => d.billNo)).size).toBe(count);
  });

  it('the BILL counter namespace is independent of the patientUid namespace', async () => {
    const counters = await plain.uidCounter.findMany();
    const billRow = counters.find((c) => c.id.includes(':bill:'));
    const pidRow = counters.find((c) => !c.id.includes(':bill:'));
    expect(billRow?.counter).toBe(2); // two orders created
    expect(pidRow?.counter).toBe(2); // two patients registered — separate rows
    expect(billRow!.id).not.toBe(pidRow!.id);

    // And the formats never collide: PIDs have no BILL segment.
    const patients = await plain.patient.findMany({ select: { patientUid: true } });
    for (const p of patients) {
      expect(p.patientUid).not.toContain('-BILL-');
    }
  });

  it('bill-number generation leaves billing amounts untouched', () => {
    expect(Number(order1.totalAmount)).toBe(100);
    expect(Number(order2.totalAmount)).toBe(100);
  });
});
