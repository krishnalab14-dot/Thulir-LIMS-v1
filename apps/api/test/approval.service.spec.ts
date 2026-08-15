import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/prisma/tenant-context.service';
import { ApprovalService } from '../src/approval/approval.service';

const ORG = 'org_demo';

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord1',
    organizationId: ORG,
    // 'billed' differs from the computed rollup below so the mock proves the
    // order.update write fires (same fixture trick as the verify unit suite).
    status: 'billed',
    orderTests: [
      { id: 'ot_verified', testNameSnapshot: 'FBS' },
      { id: 'ot_approved', testNameSnapshot: 'HbA1c' },
    ],
    ...overrides,
  };
}

function queueOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord1',
    organizationId: ORG,
    status: 'partially_approved',
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
    orderTests: [{ id: 'ot1', verifiedAt: new Date('2026-08-14T09:00:00Z') }],
    ...overrides,
  };
}

function reviewOrderRow() {
  return {
    id: 'ord1',
    organizationId: ORG,
    status: 'partially_approved',
    isUrgent: false,
    createdAt: new Date(),
    organization: { id: ORG, name: 'Thulir Demo Lab' },
    patient: { patientUid: 'THU-2026-0001', firstName: 'Ravi', lastName: 'Kumar', gender: 'male', dob: new Date('1990-01-01'), ageAtRegistration: null },
    samples: [
      {
        id: 's1',
        barcodeValue: 'ORD1-SERUM',
        status: 'collected',
        sampleType: { id: 'st1', name: 'Serum', code: 'SERUM' },
        orderTests: [
          {
            id: 'ot_verified',
            testNameSnapshot: 'FBS',
            status: 'verified',
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
            verifiedBy: 'user_test',
            verifiedAt: new Date(),
            verifyRejectedNote: null,
            approvedBy: null,
            approvedAt: null,
            approvalSignatureStamp: null,
          },
          {
            id: 'ot_approved',
            testNameSnapshot: 'HbA1c',
            status: 'approved',
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
            approvedBy: 'user_test',
            approvedAt: new Date(),
            approvalSignatureStamp: 'AABBCCDD00112233',
          },
        ],
      },
    ],
  };
}

describe('ApprovalService (mock-based unit coverage; real-DB e2e covers the concurrency race)', () => {
  const $transaction = jest.fn();
  const orderFindUnique = jest.fn();
  const orderFindMany = jest.fn();
  const prismaMock = { prisma: { order: { findUnique: orderFindUnique, findMany: orderFindMany }, $transaction } };

  let service: ApprovalService;
  let tenant: TenantContextService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ApprovalService, TenantContextService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(ApprovalService);
    tenant = moduleRef.get(TenantContextService);
  });

  function runApprove(orderTestIds: string[]) {
    const tx = {
      orderTest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ status: 'verified' }, { status: 'approved' }]),
      },
      order: { update: jest.fn().mockResolvedValue({}) },
    };
    $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));
    orderFindUnique.mockResolvedValue(orderRow());
    const promise = tenant.runAs({ organizationId: ORG, userId: 'user_test' }, () => service.approve('ord1', { orderTestIds }));
    return { tx, promise };
  }

  it('queue maps only orders with verified tests, oldest-verified-first with wait info', async () => {
    orderFindMany.mockResolvedValue([
      queueOrderRow({ id: 'ord_older', orderTests: [{ id: 'x', verifiedAt: new Date('2026-08-14T08:00:00Z') }] }),
      queueOrderRow({ id: 'ord_newer', orderTests: [{ id: 'y', verifiedAt: new Date('2026-08-14T10:00:00Z') }] }),
      queueOrderRow({ id: 'ord_latest', orderTests: [{ id: 'z', verifiedAt: new Date('2026-08-14T11:00:00Z') }] }),
    ]);
    const queue = await tenant.runAs({ organizationId: ORG, userId: 'user_test' }, () => service.getApprovalQueue());
    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ orderTests: { some: { status: 'verified' } } }) }),
    );
    expect(queue.map((q) => q.orderId)).toEqual(['ord_older', 'ord_newer', 'ord_latest']);
    expect(queue[0]).toEqual(
      expect.objectContaining({
        verifiedCount: 1,
        isUrgent: true,
        waitMs: expect.any(Number),
        patient: expect.objectContaining({ patientUid: 'THU-2026-0001', firstName: 'Ravi', ageYears: expect.any(Number) }),
      }),
    );
    expect(queue[0].waitMs).toBeGreaterThanOrEqual(0);
  });

  it('queue filters out orders with no verified tests (the caller where does the filtering)', async () => {
    orderFindMany.mockResolvedValue([]);
    const queue = await tenant.runAs({ organizationId: ORG, userId: 'user_test' }, () => service.getApprovalQueue());
    expect(queue).toEqual([]);
  });

  it('approve-review returns the entry-grid shape + approval metadata AND the preview payload', async () => {
    orderFindUnique.mockResolvedValue(reviewOrderRow());
    const review = await tenant.runAs({ organizationId: ORG, userId: 'user_test' }, () => service.getApproveReview('ord1'));
    const rows = review.samples[0].orderTests;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: 'ot_verified',
        status: 'verified',
        refLow: 70,
        unit: 'mg/dL',
        resultValue: '92',
        approvedBy: null,
        approvedAt: null,
        approvalSignatureStamp: null,
      }),
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        id: 'ot_approved',
        status: 'approved',
        approvedBy: 'user_test',
        approvedAt: expect.any(Date),
        approvalSignatureStamp: 'AABBCCDD00112233',
      }),
    );
    expect(review.summary).toEqual({ total: 2, verified: 1, approved: 1 });
    expect(review.preview).toEqual(
      expect.objectContaining({
        labName: 'Thulir Demo Lab',
        labAddress: null,
        signatureRef: 'user_test',
        verificationCode: expect.stringMatching(/^THU-VR-[0-9A-Z]+-[0-9A-F]{4}$/),
      }),
    );
  });

  it('approve-review throws NotFound for an unknown order', async () => {
    orderFindUnique.mockResolvedValue(null);
    await expect(tenant.runAs({ organizationId: ORG, userId: 'user_test' }, () => service.getApproveReview('ghost'))).rejects.toThrow('Order not found');
  });

  it('approve uses a conditional update (status = verified) and stamps actor/timestamp/signature-stamp', async () => {
    const { tx, promise } = runApprove(['ot_verified']);
    const result = await promise;

    expect(tx.orderTest.updateMany).toHaveBeenCalledWith({
      where: { id: 'ot_verified', orderId: 'ord1', status: 'verified' },
      data: expect.objectContaining({
        status: 'approved',
        approvedBy: 'user_test',
        approvedAt: expect.any(Date),
        approvalSignatureStamp: expect.stringMatching(/^[0-9A-F]{16}$/),
        verifyRejectedNote: null,
      }),
    });
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0]).toEqual(
      expect.objectContaining({
        orderTestId: 'ot_verified',
        testNameSnapshot: 'FBS',
        status: 'approved',
        approvalSignatureStamp: expect.stringMatching(/^[0-9A-F]{16}$/),
      }),
    );
    expect(result.skipped).toHaveLength(0);
    // Rollup recomputed from ALL the order's tests.
    expect(tx.orderTest.findMany).toHaveBeenCalledWith({ where: { orderId: 'ord1' }, select: { status: true } });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'ord1' }, data: { status: expect.any(String) } });
  });

  it('approve skips stale/approved rows without failing the batch', async () => {
    const { tx, promise } = runApprove(['ot_verified', 'ot_approved']);
    tx.orderTest.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const result = await promise;
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].orderTestId).toBe('ot_approved');
    expect(result.skipped[0].reason).toBe('stale');
    expect(result.skipped[0].message).toContain('HbA1c');
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0].orderTestId).toBe('ot_verified');
  });

  it('approve with zero successful writes leaves the rollup untouched', async () => {
    const { tx, promise } = runApprove(['ot_approved']);
    tx.orderTest.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await promise;
    expect(result.skipped).toHaveLength(1);
    expect(tx.orderTest.findMany).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(result.orderStatus).toBe('billed'); // initial order status, untouched
  });

  it('reject-back-to-verify is conditional on status IN (verified, approved) and NEVER touches resultValue', async () => {
    const tx = {
      orderTest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ status: 'entered' }, { status: 'approved' }]),
      },
      order: { update: jest.fn().mockResolvedValue({}) },
    };
    $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));
    orderFindUnique.mockResolvedValue(orderRow());

    const result = await tenant.runAs({ organizationId: ORG, userId: 'user_test' }, () =>
      service.rejectBackToVerify('ord1', { orderTestId: 'ot_approved', reason: 'Value inconsistent with clinical picture' }),
    );

    expect(tx.orderTest.updateMany).toHaveBeenCalledWith({
      where: { id: 'ot_approved', orderId: 'ord1', status: { in: ['verified', 'approved'] } },
      data: {
        status: 'entered',
        verifyRejectedNote: 'Value inconsistent with clinical picture',
        verifiedBy: null,
        verifiedAt: null,
        approvedBy: null,
        approvedAt: null,
        approvalSignatureStamp: null,
        // resultValue is intentionally ABSENT — reject-back never rewrites it.
      },
    });
    expect(result).toEqual(
      expect.objectContaining({ orderTestId: 'ot_approved', status: 'entered', verifyRejectedNote: 'Value inconsistent with clinical picture' }),
    );
  });

  it('reject-back-to-verify throws a 409-style conflict when the row is not verified/approved (zero rows)', async () => {
    const tx = {
      orderTest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      order: { update: jest.fn() },
    };
    $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));
    orderFindUnique.mockResolvedValue(orderRow());

    await expect(
      tenant.runAs({ organizationId: ORG, userId: 'user_test' }, () => service.rejectBackToVerify('ord1', { orderTestId: 'ot_verified', reason: 'not there' })),
    ).rejects.toThrow("not verified or approved");
    expect(tx.order.update).not.toHaveBeenCalled();
  });
});
