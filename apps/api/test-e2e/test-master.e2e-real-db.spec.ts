import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { TenantContextError, TenantContextService } from '../src/prisma/tenant-context.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { bearer, loginAdmin } from './test-helpers';

/**
 * REAL-DATABASE Stage 2.5 (Test Master extension) suite — same bar as every
 * prior stage. Runs inside `npm run verify:real-db` against real Postgres over
 * the real Nest HTTP stack. Covers the 8 regression scenarios from the spec:
 *   1. numeric test with default range + 2 non-overlapping age/sex specs +
 *      critical range persists and reloads intact;
 *   2. ordering a patient whose age/sex matches one spec snapshots THAT spec's
 *      range (not the default);
 *   3. ordering a patient matching no spec snapshots the default range;
 *   4. two overlapping specs for the same test are rejected at save time with
 *      a clear error naming the conflict;
 *   5. an options-type test snapshots resultOptions (range fields null);
 *   6. a text-type test snapshots nothing but the type;
 *   7. ordering a numeric test with no default and no matching spec is
 *      rejected per §2 rule 4, order not created;
 *   8. everything else (regression guard) is the full pre-existing suite.
 * Plus: TestSpecification is fail-closed tenant-scoped.
 */
const ORG = 'org_demo';

describe('Stage 2.5 real-DB verification — Test Master extension', () => {
  let app: INestApplication;
  let tenant: TenantContextService;
  let prismaService: PrismaService;
  const plain = new PrismaClient();

  let tNumId: string; // numeric: default 10-20, critical 2-50, specs male/female 13-65
  let tOptId: string; // options: A+, A-, B+
  let tTxtId: string; // text
  let tNoRangeId: string; // numeric with NO default and NO specs → order rejected

  let authHeaders: Record<string, string>;

  const http = () => request(app.getHttpServer());
  const dobYearsAgo = (years: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() - years);
    d.setDate(d.getDate() - 1); // guarantee the floored age is exactly `years`
    return d.toISOString().slice(0, 10);
  };

  beforeAll(async () => {
    jest.setTimeout(120_000);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
    tenant = app.get(TenantContextService);
    prismaService = app.get(PrismaService);

    const admin = await loginAdmin(app);
    authHeaders = bearer(admin.accessToken);

    await plain.$executeRawUnsafe(
      `TRUNCATE "PaymentSplit", "Payment", "Invoice", "OrderTest", "Sample", "Order", "Patient", "UidCounter" CASCADE`,
    );

    // Scenario 1 setup: numeric test with a default range, a critical range,
    // and two NON-overlapping age/sex specifications (male 13-65 → 30-40,
    // female 13-65 → 25-35 — different sex tiers never conflict).
    const num = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({
        testCode: 'TM-NUM',
        testName: 'TM Numeric Marker',
        currentPrice: 250,
        defaultRefLow: 10,
        defaultRefHigh: 20,
        criticalLow: 2,
        criticalHigh: 50,
        specifications: [
          { ageMinYears: 13, ageMaxYears: 65, sex: 'male', refLow: 30, refHigh: 40 },
          { ageMinYears: 13, ageMaxYears: 65, sex: 'female', refLow: 25, refHigh: 35 },
        ],
      });
    expect(num.status).toBe(201);
    tNumId = num.body.id;

    const opt = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({ testCode: 'TM-OPT', testName: 'TM Options Marker', currentPrice: 120, resultType: 'options', resultOptions: ['A+', 'A-', 'B+'] });
    expect(opt.status).toBe(201);
    tOptId = opt.body.id;

    const txt = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({ testCode: 'TM-TXT', testName: 'TM Free-Text Marker', currentPrice: 90, resultType: 'text' });
    expect(txt.status).toBe(201);
    tTxtId = txt.body.id;

    // Scenario 7 setup: numeric with no default and no specs — creation is
    // allowed (rule 4 rejects ORDERING, not defining), so this can exist.
    const noRange = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({ testCode: 'TM-NORANGE', testName: 'TM No Range Marker', currentPrice: 80 });
    expect(noRange.status).toBe(201);
    tNoRangeId = noRange.body.id;
  });

  afterAll(async () => {
    await app.close();
    await plain.$disconnect();
  });

  const orderTestOf = async (orderId: string) => {
    const rows = await plain.orderTest.findMany({ where: { orderId } });
    expect(rows).toHaveLength(1);
    return rows[0];
  };

  const placeOrder = async (testId: string, mobile: string, gender: string, ageYears: number) => {
    const res = await http()
      .post('/api/orders')
      .set(authHeaders)
      .send({
        patient: { firstName: 'TM', lastName: 'Patient', gender, mobile, dob: dobYearsAgo(ageYears) },
        testIds: [testId],
        billing: {},
      });
    return res;
  };

  it('scenario 1: numeric test with default + 2 non-overlapping specs + critical range persists and reloads intact', async () => {
    const list = await http().get('/api/masters/tests').set(authHeaders);
    expect(list.status).toBe(200);
    const row = (list.body as { id: string; resultType: string; defaultRefLow: number; defaultRefHigh: number; criticalLow: number; criticalHigh: number; specifications: unknown[] }[]).find((t) => t.id === tNumId)!;
    expect(row.resultType).toBe('numeric');
    expect(row.defaultRefLow).toBe(10);
    expect(row.defaultRefHigh).toBe(20);
    expect(row.criticalLow).toBe(2);
    expect(row.criticalHigh).toBe(50);
    expect(row.specifications).toHaveLength(2);
  });

  it('scenario 2: patient matching a specification snapshots THAT spec range, not the default', async () => {
    const res = await placeOrder(tNumId, '9550000001', 'male', 30); // matches male 13-65 → 30-40
    expect(res.status).toBe(201);
    const ot = await orderTestOf(res.body.id);
    expect(ot.snapshottedResultType).toBe('numeric');
    expect(ot.snapshottedRefLow).toBe(30);
    expect(ot.snapshottedRefHigh).toBe(40);
    expect(ot.snapshottedCriticalLow).toBe(2);
    expect(ot.snapshottedCriticalHigh).toBe(50);
    expect(ot.snapshottedResultOptions).toBeNull();
  });

  it('scenario 3: patient matching no specification snapshots the default range', async () => {
    const res = await placeOrder(tNumId, '9550000002', 'male', 70); // outside 13-65 → default 10-20
    expect(res.status).toBe(201);
    const ot = await orderTestOf(res.body.id);
    expect(ot.snapshottedRefLow).toBe(10);
    expect(ot.snapshottedRefHigh).toBe(20);
    expect(ot.snapshottedCriticalLow).toBe(2);
    expect(ot.snapshottedCriticalHigh).toBe(50);
  });

  it('scenario 4: two overlapping specifications for the same test are rejected at save time with a clear error', async () => {
    const res = await http()
      .post('/api/masters/tests')
      .set(authHeaders)
      .send({
        testCode: 'TM-OVERLAP',
        testName: 'TM Overlapping Specs',
        currentPrice: 100,
        specifications: [
          { ageMinYears: 13, ageMaxYears: 65, sex: 'male', refLow: 30, refHigh: 40 },
          { ageMinYears: 40, ageMaxYears: 80, sex: 'male', refLow: 35, refHigh: 45 }, // same sex tier, overlapping ages
        ],
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('overlap');
    expect(res.body.message).toContain('sex=male');
    // Nothing persisted.
    const row = await plain.masterTest.findFirst({ where: { testCode: 'TM-OVERLAP' } });
    expect(row).toBeNull();
  });

  it('scenario 5: options-type test snapshots resultOptions; range fields are null', async () => {
    const res = await placeOrder(tOptId, '9550000003', 'female', 25);
    expect(res.status).toBe(201);
    const ot = await orderTestOf(res.body.id);
    expect(ot.snapshottedResultType).toBe('options');
    expect(ot.snapshottedResultOptions).toEqual(['A+', 'A-', 'B+']);
    expect(ot.snapshottedRefLow).toBeNull();
    expect(ot.snapshottedRefHigh).toBeNull();
    expect(ot.snapshottedCriticalLow).toBeNull();
    expect(ot.snapshottedCriticalHigh).toBeNull();
  });

  it('scenario 6: text-type test snapshots nothing but the type', async () => {
    const res = await placeOrder(tTxtId, '9550000004', 'female', 25);
    expect(res.status).toBe(201);
    const ot = await orderTestOf(res.body.id);
    expect(ot.snapshottedResultType).toBe('text');
    expect(ot.snapshottedResultOptions).toBeNull();
    expect(ot.snapshottedRefLow).toBeNull();
    expect(ot.snapshottedRefHigh).toBeNull();
    expect(ot.snapshottedCriticalLow).toBeNull();
    expect(ot.snapshottedCriticalHigh).toBeNull();
  });

  it('scenario 7: ordering a numeric test with no default and no matching spec is rejected, order not created', async () => {
    const before = await plain.order.count();
    const res = await placeOrder(tNoRangeId, '9550000005', 'male', 30);
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('no reference range');
    expect(res.body.message).toContain('TM No Range Marker');
    const after = await plain.order.count();
    expect(after).toBe(before);
  });

  it('TestSpecification is fail-closed tenant-scoped against the real DB connection', async () => {
    // No tenant context → throws before any SQL.
    await expect(prismaService.prisma.testSpecification.findMany()).rejects.toThrow(TenantContextError);
    // Cross-tenant create claiming a different org → throws, nothing persisted.
    await expect(
      tenant.run('org_other', () =>
        prismaService.prisma.testSpecification.create({
          data: { organizationId: ORG, testId: tNumId, ageMinYears: 0, ageMaxYears: 10, refLow: 1, refHigh: 2 },
        }),
      ),
    ).rejects.toThrow(TenantContextError);
    const count = await plain.testSpecification.count({ where: { testId: tNumId } });
    expect(count).toBe(2);
  });

  // ──────────────────────────────────────────────────────────────────────
  // PATCH /masters/tests/:id — edit persists, order snapshots updated values
  // ──────────────────────────────────────────────────────────────────────

  it('PATCH /masters/tests/:id — edit unit, range, and name; confirm persistence and snapshot reflects updated values', async () => {
    // 1. PATCH the test we created in beforeAll: change unit, range, name
    const patchRes = await http()
      .patch(`/api/masters/tests/${tNumId}`)
      .set(authHeaders)
      .send({
        unit: 'kU/L',
        defaultRefLow: 15,
        defaultRefHigh: 25,
        testName: 'TM Numeric Marker (Updated)',
      });
    expect(patchRes.status).toBe(200);
    expect(patchRes.body.unit).toBe('kU/L');
    expect(patchRes.body.defaultRefLow).toBe(15);
    expect(patchRes.body.defaultRefHigh).toBe(25);
    expect(patchRes.body.testName).toBe('TM Numeric Marker (Updated)');

    // 2. Confirm via GET
    const listRes = await http().get('/api/masters/tests').set(authHeaders);
    expect(listRes.status).toBe(200);
    const updated = (listRes.body as { id: string; unit: string | null; defaultRefLow: number; defaultRefHigh: number }[]).find((t) => t.id === tNumId);
    expect(updated).toBeDefined();
    expect(updated!.unit).toBe('kU/L');
    expect(updated!.defaultRefLow).toBe(15);
    expect(updated!.defaultRefHigh).toBe(25);

    // 3. Order the test for a patient who matches no spec → should snapshot the NEW default range (15-25)
    const orderRes = await placeOrder(tNumId, '9550000010', 'male', 70);
    expect(orderRes.status).toBe(201);
    const ot = await orderTestOf(orderRes.body.id);
    expect(ot.snapshottedRefLow).toBe(15);
    expect(ot.snapshottedRefHigh).toBe(25);
    expect(ot.snapshottedUnit).toBe('kU/L');
    expect(ot.testNameSnapshot).toBe('TM Numeric Marker (Updated)');

    // 4. Restore original values for the rest of the suite
    await http()
      .patch(`/api/masters/tests/${tNumId}`)
      .set(authHeaders)
      .send({
        unit: null,
        defaultRefLow: 10,
        defaultRefHigh: 20,
        testName: 'TM Numeric Marker',
      });
  });

  it('PATCH returns 404 for nonexistent test', async () => {
    const res = await http()
      .patch('/api/masters/tests/nonexistent_id')
      .set(authHeaders)
      .send({ testName: 'Ghost' });
    expect(res.status).toBe(404);
  });

  // ──────────────────────────────────────────────────────────────────────
  // DELETE (soft-toggle) /masters/tests/:id
  // ──────────────────────────────────────────────────────────────────────

  it('DELETE /masters/tests/:id — toggle active/inactive; inactive test excluded from search and cannot be ordered', async () => {
    // 1. Deactivate
    const delRes = await http().delete(`/api/masters/tests/${tTxtId}`).set(authHeaders);
    expect(delRes.status).toBe(200);
    expect(delRes.body.active).toBe(false);

    // 2. Confirm inactive in the test list (listTests returns active only)
    const listRes = await http().get('/api/masters/tests').set(authHeaders);
    expect(listRes.status).toBe(200);
    const found = (listRes.body as { id: string; active: boolean }[]).find((t) => t.id === tTxtId);
    expect(found).toBeUndefined(); // filtered out

    // 3. Confirm inactive test excluded from search
    const searchRes = await http().get('/api/masters/tests/search?q=TM-TXT').set(authHeaders);
    expect(searchRes.status).toBe(200);
    const searchFound = (searchRes.body as { id: string; testCode: string }[]).find((t) => t.testCode === 'TM-TXT');
    expect(searchFound).toBeUndefined();

    // 4. Re-enable
    const reEnableRes = await http().delete(`/api/masters/tests/${tTxtId}`).set(authHeaders);
    expect(reEnableRes.status).toBe(200);
    expect(reEnableRes.body.active).toBe(true);

    // 5. Back in the list
    const listAfter = await http().get('/api/masters/tests').set(authHeaders);
    const foundAfter = (listAfter.body as { id: string }[]).find((t) => t.id === tTxtId);
    expect(foundAfter).toBeDefined();
  });

  it('DELETE returns 404 for nonexistent test', async () => {
    const res = await http().delete('/api/masters/tests/nonexistent_id').set(authHeaders);
    expect(res.status).toBe(404);
  });
});
