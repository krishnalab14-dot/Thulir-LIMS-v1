import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, OrderTestStatus } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SYSTEM_USER_ID } from '../src/common/constants';

/**
 * REAL-DATABASE Stage 3 (Result Entry) suite — same bar as every prior stage.
 * Runs inside `npm run verify:real-db` against real Postgres over the real
 * Nest HTTP stack. Covers every §6 done-criteria:
 *   - GET /api/orders/:id/results groups by Sample and returns ONLY tests
 *     whose sample is collected;
 *   - numeric entry (normal → stored; garbage → 400; edit via CAS);
 *   - options entry (valid → stored; invalid option → 400);
 *   - text entry (empty = not yet entered → never advances status; clear works);
 *   - saving for an uncollected sample's test → 400;
 *   - auto-complete cascade: last value entered advances Order.status rollup
 *     (billed → entered → partially_verified);
 *   - CONCURRENCY: two simultaneous saves of the same pending OrderTest with
 *     different values → exactly one lands, the other is reported as skipped
 *     (never silently overwritten, never a crash);
 *   - CAS: a stale edit (wrong expectedValue) is skipped; a verified row is
 *     guarded (skipped) even though verified/approved don't exist yet.
 */
const ORG = 'org_demo';

describe('Stage 3 real-DB verification — result entry', () => {
  let app: INestApplication;
  const plain = new PrismaClient();

  let tNumeric: string; // S3 Glucose — serum, 70-99, critical 40-400
  let tOptions: string; // S3 Blood Group — edta, A+/A-/B+, B+ abnormal
  let tText: string; // S3 Urine Microscopy — serum, free text
  let tStandalone: string; // S3 CRP — serum (concurrency + uncollected tests)

  let order1Id: string; // [numeric, options, text] — the main entry order
  let order2Id: string; // [standalone] — sample left UNCOLLECTED (400 guard)
  let order3Id: string; // [standalone] — collected, drives the concurrency race

  let serumSampleId: string; // order1 — collected mid-suite
  let edtaSampleId: string; // order1 — collected mid-suite
  let otNumeric: string;
  let otOptions: string;
  let otText: string;
  let otStandaloneOrder2: string;
  let otConcurrency: string;

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

    const stSerum = await http().post('/api/masters/sample-types').set('x-organization-id', ORG).send({ name: 'Serum Tube' });
    const stEdta = await http().post('/api/masters/sample-types').set('x-organization-id', ORG).send({ name: 'EDTA Tube' });
    expect([stSerum.status, stEdta.status]).toEqual([201, 201]);

    const num = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({
        testCode: 'S3-GLU',
        testName: 'S3 Glucose',
        currentPrice: 150,
        requiredSampleTypeId: stSerum.body.id,
        defaultRefLow: 70,
        defaultRefHigh: 99,
        criticalLow: 40,
        criticalHigh: 400,
        // Stage 3 follow-up: unit snapshots onto OrderTest.snapshottedUnit.
        unit: 'mg/dL',
      });
    const opt = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({
        testCode: 'S3-BG',
        testName: 'S3 Blood Group',
        currentPrice: 150,
        requiredSampleTypeId: stEdta.body.id,
        resultType: 'options',
        resultOptions: ['A+', 'A-', 'B+'],
        resultOptionsAbnormal: ['B+'],
      });
    const txt = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({ testCode: 'S3-URN', testName: 'S3 Urine Microscopy', currentPrice: 90, requiredSampleTypeId: stSerum.body.id, resultType: 'text' });
    const crp = await http()
      .post('/api/masters/tests')
      .set('x-organization-id', ORG)
      .send({ testCode: 'S3-CRP', testName: 'S3 CRP', currentPrice: 450, requiredSampleTypeId: stSerum.body.id, defaultRefLow: 0, defaultRefHigh: 5, criticalLow: 10, criticalHigh: 200 });
    expect([num.status, opt.status, txt.status, crp.status]).toEqual([201, 201, 201, 201]);
    tNumeric = num.body.id;
    tOptions = opt.body.id;
    tText = txt.body.id;
    tStandalone = crp.body.id;

    // Order 1: numeric + options + text (serum + edta samples).
    const o1 = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Res', lastName: 'Patient', gender: 'female', mobile: '9330000001', dob: '1988-01-01' },
        testIds: [tNumeric, tOptions, tText],
        billing: {},
      });
    expect(o1.status).toBe(201);
    order1Id = o1.body.id;
    expect(o1.body.status).toBe('billed'); // all pending → rollup billed

    // Order 2: standalone, sample stays UNCOLLECTED (the 400 guard).
    const o2 = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Uncol', lastName: 'Patient', gender: 'male', mobile: '9330000002', dob: '1990-02-02' },
        testIds: [tStandalone],
        billing: {},
      });
    expect(o2.status).toBe(201);
    order2Id = o2.body.id;

    // Order 3: standalone, sample collected — drives the concurrency race.
    const o3 = await http()
      .post('/api/orders')
      .set('x-organization-id', ORG)
      .send({
        patient: { firstName: 'Race', lastName: 'Patient', gender: 'male', mobile: '9330000003', dob: '1991-03-03' },
        testIds: [tStandalone],
        billing: {},
      });
    expect(o3.status).toBe(201);
    order3Id = o3.body.id;

    // Resolve ids + link rows.
    const samples1 = await plain.sample.findMany({ where: { orderId: order1Id } });
    serumSampleId = samples1.find((s) => s.sampleTypeId === stSerum.body.id)!.id;
    edtaSampleId = samples1.find((s) => s.sampleTypeId === stEdta.body.id)!.id;

    const tests1 = await plain.orderTest.findMany({ where: { orderId: order1Id } });
    otNumeric = tests1.find((t) => t.testId === tNumeric)!.id;
    otOptions = tests1.find((t) => t.testId === tOptions)!.id;
    otText = tests1.find((t) => t.testId === tText)!.id;
    otStandaloneOrder2 = (await plain.orderTest.findFirst({ where: { orderId: order2Id } }))!.id;
    otConcurrency = (await plain.orderTest.findFirst({ where: { orderId: order3Id } }))!.id;

    // Collect order1's EDTA sample only — the Serum sample stays uncollected
    // for the "only collected samples appear" assertion.
    await http().put(`/api/samples/${edtaSampleId}/collect`).set('x-organization-id', ORG);
    // Collect order3's sample (concurrency target).
    const o3Sample = await plain.sample.findFirst({ where: { orderId: order3Id } });
    await http().put(`/api/samples/${o3Sample!.id}/collect`).set('x-organization-id', ORG);
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  it('GET /results returns only COLLECTED samples, grouped by sample with full snapshot data', async () => {
    const res = await http().get(`/api/orders/${order1Id}/results`).set('x-organization-id', ORG);
    expect(res.status).toBe(200);

    // Only the collected EDTA sample (options test) — the uncollected Serum
    // sample (numeric + text) is absent even though the order owns it.
    const samples = res.body.samples as Array<{ id: string; orderTests: unknown[] }>;
    expect(samples).toHaveLength(1);
    expect(samples[0].id).toBe(edtaSampleId);
    expect(samples[0].orderTests).toHaveLength(1);
    const row = samples[0].orderTests[0] as Record<string, unknown>;
    expect(row.id).toBe(otOptions);
    expect(row.resultType).toBe('options');
    expect(row.resultOptions).toEqual(['A+', 'A-', 'B+']);
    expect(row.abnormalOptions).toEqual(['B+']);
    expect(row.resultValue).toBeNull();
    expect(row.status).toBe('pending');
    // Options-type test was created WITHOUT a unit → payload carries null,
    // never "undefined" (the grid renders a dash).
    expect(row.unit).toBeNull();

    expect(res.body.summary).toEqual({ total: 1, entered: 0 });
    expect(res.body.patient.ageYears).toBeGreaterThan(30);
    expect(res.body.order.id).toBe(order1Id);
  });

  it('collecting the serum sample exposes the numeric + text tests in the grid', async () => {
    await http().put(`/api/samples/${serumSampleId}/collect`).set('x-organization-id', ORG);
    const res = await http().get(`/api/orders/${order1Id}/results`).set('x-organization-id', ORG);
    expect(res.status).toBe(200);
    const samples = res.body.samples as Array<{ id: string; orderTests: Array<{ id: string; resultType: string; unit: string | null; refLow: number | null; refHigh: number | null; criticalLow: number | null; criticalHigh: number | null }> }>;
    expect(samples).toHaveLength(2);
    const serum = samples.find((s) => s.id === serumSampleId)!;
    expect(serum.orderTests.map((t) => t.id).sort()).toEqual([otNumeric, otText].sort());
    const numeric = serum.orderTests.find((t) => t.id === otNumeric)!;
    expect(numeric.refLow).toBe(70);
    expect(numeric.refHigh).toBe(99);
    expect(numeric.criticalLow).toBe(40);
    expect(numeric.criticalHigh).toBe(400);
    // Stage 3 follow-up: the unit set in Masters is snapshotted onto the
    // OrderTest row and surfaced by GET /results.
    expect(numeric.unit).toBe('mg/dL');
    const textRow = serum.orderTests.find((t) => t.id === otText)!;
    expect(textRow.unit).toBeNull(); // created without a unit → null
    expect(res.body.summary).toEqual({ total: 3, entered: 0 });
  });

  it('numeric entry stores the value, stamps actor/timestamp, and advances the rollup to "entered"', async () => {
    const before = new Date();
    const res = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otNumeric, resultValue: '92' }] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(1);
    expect(res.body.skipped).toHaveLength(0);
    expect(res.body.updated[0]).toEqual(
      expect.objectContaining({ orderTestId: otNumeric, resultValue: '92', status: 'entered' }),
    );
    expect(res.body.orderStatus).toBe('entered'); // some entered, not all → entered

    const row = await plain.orderTest.findUnique({ where: { id: otNumeric } });
    expect(row!.resultValue).toBe('92');
    expect(row!.status).toBe('entered');
    expect(row!.enteredBy).toBe(SYSTEM_USER_ID);
    expect(row!.enteredAt!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    // Stage 3 follow-up: snapshottedUnit persisted at order time.
    expect(row!.snapshottedUnit).toBe('mg/dL');

    const order = await plain.order.findUnique({ where: { id: order1Id } });
    expect(order!.status).toBe('entered');
  });

  it('editing an entered row via CAS (expectedValue = current value) works; a stale CAS is skipped', async () => {
    // Legit edit: expectedValue matches the stored '92'.
    const edit = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otNumeric, resultValue: '140', expectedValue: '92' }] });
    expect(edit.status).toBe(200);
    expect(edit.body.updated).toHaveLength(1);
    expect(edit.body.skipped).toHaveLength(0);

    // Stale edit: expectedValue no longer matches ('92' was replaced by '140').
    const stale = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otNumeric, resultValue: '88', expectedValue: '92' }] });
    expect(stale.status).toBe(200);
    expect(stale.body.updated).toHaveLength(0);
    expect(stale.body.skipped).toHaveLength(1);
    expect(stale.body.skipped[0].reason).toBe('stale');

    const row = await plain.orderTest.findUnique({ where: { id: otNumeric } });
    expect(row!.resultValue).toBe('140'); // untouched by the stale write
  });

  it('rejects a non-numeric value server-side (400), nothing changes', async () => {
    const res = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otNumeric, resultValue: 'abc' }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('valid number');
    const row = await plain.orderTest.findUnique({ where: { id: otNumeric } });
    expect(row!.resultValue).toBe('140');
  });

  it('options entry accepts only snapshotted options; an invalid option is rejected (400)', async () => {
    const ok = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otOptions, resultValue: 'A+' }] });
    expect(ok.status).toBe(200);
    expect(ok.body.updated[0].resultValue).toBe('A+');

    const bad = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otOptions, resultValue: 'AB+' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.message).toContain('A+, A-, B+');

    const row = await plain.orderTest.findUnique({ where: { id: otOptions } });
    expect(row!.resultValue).toBe('A+'); // untouched by the rejected write
    // Options-type test created WITHOUT a unit — order + entry work fine, the
    // snapshot is simply null (unit is a purely additive nullable field).
    expect(row!.snapshottedUnit).toBeNull();
  });

  it('empty text is "not yet entered" — never advances status; clearing a value reverts to pending', async () => {
    const empty = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otText, resultValue: '' }] });
    expect(empty.status).toBe(200);
    const rowAfterEmpty = await plain.orderTest.findUnique({ where: { id: otText } });
    expect(rowAfterEmpty!.status).toBe('pending');
    expect(rowAfterEmpty!.resultValue).toBeNull();
    expect(rowAfterEmpty!.enteredBy).toBeNull();

    const entered = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otText, resultValue: 'Occasional pus cells seen' }] });
    expect(entered.status).toBe(200);
    expect(entered.body.updated[0].status).toBe('entered');

    // Clear it back (CAS on the current value).
    const cleared = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otText, resultValue: '', expectedValue: 'Occasional pus cells seen' }] });
    expect(cleared.status).toBe(200);
    const rowAfterClear = await plain.orderTest.findUnique({ where: { id: otText } });
    expect(rowAfterClear!.status).toBe('pending');
    expect(rowAfterClear!.resultValue).toBeNull();
    expect(rowAfterClear!.enteredBy).toBeNull();
    expect(rowAfterClear!.enteredAt).toBeNull();
  });

  it('auto-complete cascade: entering the LAST value advances Order.status (entered → partially_verified)', async () => {
    // otNumeric = entered, otOptions = entered, otText = pending (cleared above).
    const res = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otText, resultValue: 'No abnormality detected' }] });
    expect(res.status).toBe(200);
    // All three rows are now entered → the rollup advances one rung on the
    // Stage 1 ladder (all at least entered, none verified → partially_verified).
    expect(res.body.orderStatus).toBe('partially_verified');
    const order = await plain.order.findUnique({ where: { id: order1Id } });
    expect(order!.status).toBe('partially_verified');
  });

  it('a verified/approved row is guarded even though those stages do not exist yet', async () => {
    await plain.orderTest.update({ where: { id: otOptions }, data: { status: OrderTestStatus.verified } });
    const res = await http()
      .put(`/api/orders/${order1Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otOptions, resultValue: 'B+', expectedValue: 'A+' }] });
    expect(res.status).toBe(200);
    expect(res.body.updated).toHaveLength(0);
    expect(res.body.skipped).toHaveLength(1);
    const row = await plain.orderTest.findUnique({ where: { id: otOptions } });
    expect(row!.resultValue).toBe('A+'); // untouched
    expect(row!.status).toBe('verified'); // untouched
  });

  it('saving a result for an uncollected sample’s test is rejected at the API level (400)', async () => {
    const res = await http()
      .put(`/api/orders/${order2Id}/results`)
      .set('x-organization-id', ORG)
      .send({ entries: [{ orderTestId: otStandaloneOrder2, resultValue: '2.5' }] });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('has not been collected');
    const row = await plain.orderTest.findUnique({ where: { id: otStandaloneOrder2 } });
    expect(row!.status).toBe('pending');
    expect(row!.resultValue).toBeNull();
  });

  it('CONCURRENCY: two simultaneous saves of the same pending OrderTest → exactly one lands, the other is skipped', async () => {
    // otConcurrency is pending with resultValue null. Both requests target the
    // entry path (expectedValue omitted ⇒ CAS on null). The conditional
    // UPDATE re-evaluates its predicate against the winner's committed row,
    // so the loser matches 0 rows → skipped. Never a silent overwrite.
    const [a, b] = await Promise.all([
      http().put(`/api/orders/${order3Id}/results`).set('x-organization-id', ORG).send({ entries: [{ orderTestId: otConcurrency, resultValue: '2.1' }] }),
      http().put(`/api/orders/${order3Id}/results`).set('x-organization-id', ORG).send({ entries: [{ orderTestId: otConcurrency, resultValue: '3.4' }] }),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const landed = [a, b].filter((r) => r.body.updated.length === 1);
    const skipped = [a, b].filter((r) => r.body.skipped.length === 1);
    expect(landed).toHaveLength(1);
    expect(skipped).toHaveLength(1);
    expect(skipped[0].body.skipped[0].reason).toBe('stale');

    // Exactly ONE value in the DB — no double write, no crash.
    const row = await plain.orderTest.findUnique({ where: { id: otConcurrency } });
    expect(row!.resultValue).not.toBeNull();
    expect(['2.1', '3.4']).toContain(row!.resultValue);
    const enteredRows = await plain.orderTest.findMany({ where: { id: otConcurrency, resultValue: { not: null } } });
    expect(enteredRows).toHaveLength(1);
  });

  it('GET /results reflects entered statuses and the updated summary after entry', async () => {
    const res = await http().get(`/api/orders/${order1Id}/results`).set('x-organization-id', ORG);
    expect(res.status).toBe(200);
    expect(res.body.summary.total).toBe(3);
    // numeric + text are entered; options is verified — all three have a result.
    expect(res.body.summary.entered).toBe(3);
    const otRows = res.body.samples.flatMap((s: { orderTests: unknown[] }) => s.orderTests) as Array<{ id: string; resultValue: string | null }>;
    const num = otRows.find((t: { id: string }) => t.id === otNumeric)!;
    expect(num.resultValue).toBe('140');
  });
});
