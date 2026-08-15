import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/prisma/tenant-context.service';
import { VerifyService } from '../src/verify/verify.service';

const ORG = 'org_demo';
// Stage 7: services stamp the AUTHENTICATED user (from the tenant context),
// never a stub — unit tests run inside a context with a fixed test user.
const USER = 'user_test';

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord1',
    organizationId: ORG,
    status: 'billed',
    orderTests: [
      { id: 'ot_entered', testNameSnapshot: 'FBS' },
      { id: 'ot_verified', testNameSnapshot: 'HbA1c' },
    ],
    ...overrides,
  };
}

function queueOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord1',
    organizationId: ORG,
    status: 'entered',
    isUrgent: true,
    createdAt: new Date('2026-08-01T10:00:00Z'),
    patient: {
      id: 'pat1',
      patientUid: 'THU-2026-0001',
      firstName: 'Ravi',
      lastName: 'Kumar',
      gender: 'male',
      dob: new Date('1990-01-01'),
      ageAtRegistration: null,
    },
    orderTests: [{ id: 'ot1', enteredAt: new Date('2026-08-14T09:00:00Z') }],
    ...overrides,
  };
}

describe('VerifyService (mock-based unit coverage; real-DB e2e covers the concurrency race)', () => {
  const $transaction = jest.fn();
  const orderFindUnique = jest.fn();
  const orderFindMany = jest.fn();
  const prismaMock = { prisma: { order: { findUnique: orderFindUnique, findMany: orderFindMany }, $transaction } };

  let service: VerifyService;
  let tenant: TenantContextService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [VerifyService, TenantContextService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(VerifyService);
    tenant = moduleRef.get(TenantContextService);
  });

  function runVerify(orderTestIds: string[]) {
    const tx = {
      orderTest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ status: 'entered' }, { status: 'verified' }]),
      },
      order: { update: jest.fn().mockResolvedValue({}) },
    };
    $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));
    orderFindUnique.mockResolvedValue(orderRow());
    const promise = tenant.runAs({ organizationId: ORG, userId: USER }, () => service.verify('ord1', { orderTestIds }));
    return { tx, promise };
  }

  it('queue maps only orders with entered tests, oldest-entered-first with wait info', async () => {
    orderFindMany.mockResolvedValue([
      queueOrderRow({ id: 'ord_older', orderTests: [{ id: 'x', enteredAt: new Date('2026-08-14T08:00:00Z') }] }),
      queueOrderRow({ id: 'ord_newer', orderTests: [{ id: 'y', enteredAt: new Date('2026-08-14T10:00:00Z') }] }),
      queueOrderRow({ id: 'ord_latest', orderTests: [{ id: 'z', enteredAt: new Date('2026-08-14T11:00:00Z') }] }),
    ]);
    const queue = await tenant.runAs({ organizationId: ORG, userId: USER }, () => service.getVerifyQueue());
    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orderTests: { some: { status: 'entered' } } }) }),
    );
    expect(queue.map((q) => q.orderId)).toEqual(['ord_older', 'ord_newer', 'ord_latest']);
    expect(queue[0]).toEqual(
      expect.objectContaining({
        enteredCount: 1,
        isUrgent: true,
        waitMs: expect.any(Number),
        patient: expect.objectContaining({ patientUid: 'THU-2026-0001', firstName: 'Ravi', ageYears: expect.any(Number) }),
      }),
    );
    expect(queue[0].waitMs).toBeGreaterThanOrEqual(0);
  });

  it('queue filters out orders with no entered tests (the caller where does the filtering)', async () => {
    orderFindMany.mockResolvedValue([]);
    const queue = await tenant.runAs({ organizationId: ORG, userId: USER }, () => service.getVerifyQueue());
    expect(queue).toEqual([]);
  });

  it('review returns every test with the entry-grid shape plus verification metadata', async () => {
    orderFindUnique.mockResolvedValue({
      id: 'ord1',
      organizationId: ORG,
      status: 'partially_verified',
      isUrgent: false,
      createdAt: new Date(),
      patient: { patientUid: 'THU-2026-0001', firstName: 'Ravi', lastName: 'Kumar', gender: 'male', dob: new Date('1990-01-01'), ageAtRegistration: null },
      samples: [
        {
          id: 's1',
          barcodeValue: 'ORD1-SERUM',
          status: 'collected',
          sampleType: { id: 'st1', name: 'Serum', code: 'SERUM' },
          orderTests: [
            {
              id: 'ot_entered',
              testNameSnapshot: 'FBS',
              status: 'entered',
              snapshottedResultType: 'numeric',
              snapshottedResultOptions: null,
              snapshottedResultOptionsAbnormal: [],
              snapshottedRefLow: 70,
              snapshottedRefHigh: 99,
              snapshottedCriticalLow: 40,
              snapshottedCriticalHigh: 400,
              snapshottedUnit: 'mg/dL',
              resultValue: '92',
              enteredBy: 'user_test',
              enteredAt: new Date(),
              verifiedBy: null,
              verifiedAt: null,
              verifyRejectedNote: null,
            },
            {
              id: 'ot_verified',
              testNameSnapshot: 'HbA1c',
              status: 'verified',
              snapshottedResultType: 'numeric',
              snapshottedResultOptions: null,
              snapshottedResultOptionsAbnormal: [],
              snapshottedRefLow: 4,
              snapshottedRefHigh: 6,
              snapshottedCriticalLow: 3,
              snapshottedCriticalHigh: 8,
              snapshottedUnit: null,
              resultValue: '5.6',
              enteredBy: 'user_test',
              enteredAt: new Date(),
              verifiedBy: 'user_test',
              verifiedAt: new Date(),
              verifyRejectedNote: null,
            },
          ],
        },
      ],
    });
    const review = await tenant.runAs({ organizationId: ORG, userId: USER }, () => service.getReview('ord1'));
    const rows = review.samples[0].orderTests;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({ id: 'ot_entered', status: 'entered', refLow: 70, unit: 'mg/dL', resultValue: '92', verifiedBy: null }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({ id: 'ot_verified', status: 'verified', verifiedBy: 'user_test', verifiedAt: expect.any(Date) }),
    );
    expect(review.summary).toEqual({ total: 2, entered: 1, verified: 1 });
  });

  it('review throws NotFound for an unknown order', async () => {
    orderFindUnique.mockResolvedValue(null);
    await expect(tenant.runAs({ organizationId: ORG, userId: USER }, () => service.getReview('ghost'))).rejects.toThrow('Order not found');
  });

  it('verify uses a conditional update (status = entered) and stamps actor/timestamp', async () => {
    const { tx, promise } = runVerify(['ot_entered']);
    const result = await promise;

    expect(tx.orderTest.updateMany).toHaveBeenCalledWith({
      where: { id: 'ot_entered', orderId: 'ord1', status: 'entered' },
      data: expect.objectContaining({
        status: 'verified',
        verifiedBy: 'user_test',
        verifiedAt: expect.any(Date),
        verifyRejectedNote: null,
      }),
    });
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0]).toEqual(
      expect.objectContaining({ orderTestId: 'ot_entered', testNameSnapshot: 'FBS', status: 'verified' }),
    );
    expect(result.skipped).toHaveLength(0);
    // Rollup recomputed from ALL the order's tests.
    expect(tx.orderTest.findMany).toHaveBeenCalledWith({ where: { orderId: 'ord1' }, select: { status: true } });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'ord1' }, data: { status: expect.any(String) } });
    expect(result.orderStatus).toBe('partially_verified');
  });

  it('verify skips stale/verified rows without failing the batch', async () => {
    const { tx, promise } = runVerify(['ot_verified', 'ot_entered']);
    tx.orderTest.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const result = await promise;

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toEqual(
      expect.objectContaining({ orderTestId: 'ot_verified', reason: 'stale' }),
    );
    expect(result.skipped[0].message).toContain('HbA1c');
    expect(result.verified).toHaveLength(1);
    expect(result.verified[0].orderTestId).toBe('ot_entered');
  });

  it('verify with zero successful writes leaves the rollup untouched', async () => {
    const { tx, promise } = runVerify(['ot_verified']);
    tx.orderTest.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await promise;
    expect(result.skipped).toHaveLength(1);
    expect(tx.orderTest.findMany).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(result.orderStatus).toBe('billed'); // initial order status, untouched
  });

  it('reject-back is conditional on status = verified and NEVER touches resultValue', async () => {
    const tx = {
      orderTest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ status: 'entered' }, { status: 'entered' }]),
      },
      order: { update: jest.fn().mockResolvedValue({}) },
    };
    $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));
    orderFindUnique.mockResolvedValue(orderRow());

    const result = await tenant.runAs({ organizationId: ORG, userId: USER }, () =>
      service.rejectBack('ord1', { orderTestId: 'ot_verified', reason: 'Typing error in Sugar value' }),
    );

    expect(tx.orderTest.updateMany).toHaveBeenCalledWith({
      where: { id: 'ot_verified', orderId: 'ord1', status: 'verified' },
      data: {
        status: 'entered',
        verifiedBy: null,
        verifiedAt: null,
        verifyRejectedNote: 'Typing error in Sugar value',
        // resultValue is intentionally ABSENT — reject-back never rewrites it.
      },
    });
    expect(result).toEqual(
      expect.objectContaining({ orderTestId: 'ot_verified', status: 'entered', verifyRejectedNote: 'Typing error in Sugar value' }),
    );
  });

  it('reject-back throws a 409-style conflict when the row is not verified (zero rows)', async () => {
    const tx = {
      orderTest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      order: { update: jest.fn() },
    };
    $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));
    orderFindUnique.mockResolvedValue(orderRow());

    await expect(
      tenant.runAs({ organizationId: ORG, userId: USER }, () => service.rejectBack('ord1', { orderTestId: 'ot_entered', reason: 'not verified' })),
    ).rejects.toThrow("not in 'verified' status");
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});
