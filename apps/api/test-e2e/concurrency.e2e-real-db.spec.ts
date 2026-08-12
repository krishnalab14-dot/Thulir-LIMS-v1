import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * CONCURRENCY verification against the real embedded Postgres — the gate
 * before Stage 2. Unlike the sequential done-criteria tests, this fires full
 * bursts of requests TRULY in parallel (Promise.all, never an await-loop) and
 * asserts:
 *   1. zero patientUid collisions under parallel load
 *   2. correct sequential numbering — gapless, strictly increasing, resuming
 *      across bursts. This is guaranteed by the atomic UidCounter
 *      (`INSERT ... ON CONFLICT ... RETURNING`, see patient-uid.util.ts),
 *      which serializes writers on the single counter row by construction.
 *   3. zero order/OrderTest creation errors
 *   4. no deadlocks — any Postgres 40P01 / Prisma P2034 (write conflict or
 *      deadlock) or P2002 (unique collision) would surface as a non-2xx
 *      response and fail these tests.
 *
 * Runs via `npm run verify:real-db` (and CI's real-db job) against the live
 * DB; the unit suite never executes this file.
 */
const ORG = 'org_demo';
const BATCH = 20;

describe('Stage 1 concurrency verification (real Postgres, Promise.all)', () => {
  let app: INestApplication;
  const plain = new PrismaClient();

  let standaloneTestId: string;
  let standalonePrice: number;
  let pkgId: string;
  let pkgPrice: number;
  let subtotal: number;

  const http = () => request(app.getHttpServer());
  const seqOf = (uid: string): number => Number(uid.split('-')[2]);

  beforeAll(async () => {
    jest.setTimeout(120_000);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();

    // Wipe transactional data so the UidCounter starts at a known state (the
    // seed creates no patients and no counter rows). Same pattern as the
    // orders spec; a plain client keeps the truncate tenant-extension-free.
    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Order", "Patient", "UidCounter" CASCADE`,
    );

    // Pick a package + a standalone test NOT inside it (overlap is rejected
    // server-side, so the pair must be disjoint). Stage 2.1: prefer a test
    // flagged requiresDedicatedSample so the burst exercises the dedicated
    // barcode path under parallel load; fall back to a shared test if the
    // seeded catalog has none left outside the chosen package.
    const pkg = await plain.masterTestPackage.findFirst({ where: { active: true }, include: { items: true } });
    const inPkg = pkg?.items.map((i) => i.testId) ?? [];
    const test =
      (await plain.masterTest.findFirst({ where: { active: true, requiresDedicatedSample: true, id: { notIn: inPkg } } })) ??
      (await plain.masterTest.findFirst({ where: { active: true, id: { notIn: inPkg } } }));
    if (!pkg || !test) {
      throw new Error('seeded catalog missing a package or a disjoint standalone test');
    }
    standaloneTestId = test.id;
    standalonePrice = test.currentPrice.toNumber();
    pkgId = pkg.id;
    pkgPrice = pkg.packagePrice.toNumber();
    subtotal = standalonePrice + pkgPrice;
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  it(`registers ${BATCH} patients in parallel — zero UID collisions, gapless sequence`, async () => {
    const results = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        http()
          .post('/api/patients')
          .set('x-organization-id', ORG)
          .send({
            firstName: `Conc${i}`,
            lastName: 'Reg',
            gender: 'female',
            mobile: `9110000${String(100 + i)}`, // 9110000100..9110000119
            dob: '1990-01-01',
          }),
      ),
    );

    const bad = results.filter((r) => r.status !== 201);
    // Fail with the actual statuses + error messages, so a CI failure is
    // self-explanatory (e.g. P2028 pool exhaustion or P2034 deadlock).
    expect(bad.map((r) => `${r.status}: ${r.body?.message ?? JSON.stringify(r.body).slice(0, 160)}`)).toEqual([]);
    for (const r of results) {
      expect(r.body.patientUid).toMatch(/^THU-2026-\d{4}$/);
    }

    const uids = results.map((r) => r.body.patientUid as string);
    expect(new Set(uids).size).toBe(BATCH); // zero collisions

    const seqs = uids.map(seqOf).sort((a, b) => a - b);
    expect(seqs[0]).toBe(1); // counter started fresh at 0001
    for (let i = 0; i < BATCH - 1; i++) {
      expect(seqs[i + 1]).toBe(seqs[i] + 1); // strictly sequential, gapless
    }

    expect(await plain.patient.count({ where: { mobile: { startsWith: '9110000' } } })).toBe(BATCH);
  });

  it(`creates ${BATCH} orders in parallel, each registering its patient inline — zero errors, no deadlocks`, async () => {
    // ONE Promise.all wave: every request runs the full order transaction
    // (patient create with UID generation + package + standalone + invoice +
    // paid-in-full split payment) simultaneously. This is the maximum-contention
    // path — 20 transactions contending for the single UidCounter row.
    const results = await Promise.all(
      Array.from({ length: BATCH }, (_, i) =>
        http()
          .post('/api/orders')
          .set('x-organization-id', ORG)
          .send({
            patient: {
              firstName: `Ord${i}`,
              lastName: 'Conc',
              gender: 'male',
              mobile: `9220000${String(100 + i)}`, // 9220000100..9220000119
              dob: '1988-05-05',
            },
            orderDetails: { isUrgent: i % 2 === 0, clinicalNotes: `concurrency order ${i}` },
            testIds: [standaloneTestId],
            packageIds: [pkgId],
            billing: {},
            payment: { splits: [{ mode: 'cash', amount: standalonePrice }, { mode: 'upi', amount: pkgPrice }] },
          }),
      ),
    );

    const bad = results.filter((r) => r.status !== 201);
    // Fail with the actual statuses + error messages (P2028 pool exhaustion,
    // P2034 deadlock, P2002 collision would all show up here).
    expect(bad.map((r) => `${r.status}: ${r.body?.message ?? JSON.stringify(r.body).slice(0, 160)}`)).toEqual([]);
    for (const r of results) {
      const order = r.body;
      expect(order.orderTests).toHaveLength(4); // 1 standalone + 3 package constituents
      expect(order.orderTests.every((t: { status: string }) => t.status === 'pending')).toBe(true);
      expect(order.invoice.status).toBe('paid');
      expect(Number(order.subtotal)).toBe(subtotal);
      expect(Number(order.totalAmount)).toBe(subtotal);
      expect(order.invoice.payments).toHaveLength(1);
      expect(order.invoice.payments[0].splits).toHaveLength(2);
      expect(order.patient.patientUid).toMatch(/^THU-2026-\d{4}$/);
    }

    const orderIds = results.map((r) => r.body.id as string);
    expect(new Set(orderIds).size).toBe(BATCH);

    // Inline patients from this wave: unique AND continuing gaplessly from the
    // registration burst above (counter resumed at 21) — the sequence survives
    // concurrent batches.
    const uids = results.map((r) => r.body.patient.patientUid as string);
    expect(new Set(uids).size).toBe(BATCH);
    const seqs = uids.map(seqOf).sort((a, b) => a - b);
    expect(seqs[0]).toBe(BATCH + 1);
    for (let i = 0; i < BATCH - 1; i++) {
      expect(seqs[i + 1]).toBe(seqs[i] + 1);
    }

    // Every row landed in the real DB, correctly shaped.
    const orders = await plain.order.findMany({
      where: { id: { in: orderIds } },
      include: { orderTests: true, invoice: { include: { payments: { include: { splits: true } } } } },
    });
    expect(orders).toHaveLength(BATCH);
    const testRows = orders.flatMap((o) => o.orderTests);
    expect(testRows).toHaveLength(BATCH * 4);
    expect(testRows.every((t) => t.status === 'pending')).toBe(true);
    expect(orders.every((o) => o.invoice!.status === 'paid')).toBe(true);
    expect(orders.flatMap((o) => o.invoice!.payments.flatMap((p) => p.splits))).toHaveLength(BATCH * 2);

    // Snapshot invariant per order: the sum of all OrderTest prices equals the
    // server-computed subtotal (package billed at ITS price — 1150 for
    // pkg_basic — never at the 1350 standalone sum of its constituents).
    for (const o of orders) {
      const sum = o.orderTests.reduce((acc, t) => acc.plus(t.snapshottedPrice), new Prisma.Decimal(0));
      expect(Number(sum)).toBe(subtotal);
    }

    // Stage 2.1 regression: this burst mixes dedicated and shared tests, so
    // every sample barcode must still be unique across all 20 orders — the
    // dedicated barcode (full order id + test id) must not reintroduce the
    // same-millisecond collision the shared barcode's truncation caused.
    const samples = await plain.sample.findMany({ where: { orderId: { in: orderIds } } });
    expect(samples.length).toBeGreaterThanOrEqual(BATCH * 2); // package tubes + dedicated standalone
    const barcodes = samples.map((s) => s.barcodeValue);
    expect(new Set(barcodes).size).toBe(barcodes.length); // zero barcode collisions
    expect(samples.every((s) => s.status === 'pending_collection')).toBe(true);
  });
});
