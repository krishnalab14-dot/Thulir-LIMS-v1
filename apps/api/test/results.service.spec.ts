import { Test } from '@nestjs/testing';
import { OrderTestStatus } from '@prisma/client';
import { ResultsService } from '../src/results/results.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/prisma/tenant-context.service';

const ORG = 'org_demo';

function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord1',
    organizationId: ORG,
    status: 'billed',
    orderTests: [
      {
        id: 'ot_num',
        testNameSnapshot: 'FBS',
        status: 'pending',
        snapshottedResultType: 'numeric',
        snapshottedResultOptions: null,
        snapshottedResultOptionsAbnormal: [],
        sample: { status: 'collected' },
      },
      {
        id: 'ot_opt',
        testNameSnapshot: 'Blood Group',
        status: 'pending',
        snapshottedResultType: 'options',
        snapshottedResultOptions: ['A+', 'A-', 'B+'],
        snapshottedResultOptionsAbnormal: ['B+'],
        sample: { status: 'collected' },
      },
      {
        id: 'ot_txt',
        testNameSnapshot: 'Urine Microscopy',
        status: 'pending',
        snapshottedResultType: 'text',
        snapshottedResultOptions: null,
        snapshottedResultOptionsAbnormal: [],
        sample: { status: 'pending_collection' }, // NOT collected → not enterable
      },
    ],
    ...overrides,
  };
}

describe('ResultsService.saveResults (mock-based unit coverage; real-DB e2e covers the concurrency race)', () => {
  const $transaction = jest.fn();
  const orderFindUnique = jest.fn();
  const prismaMock = { prisma: { order: { findUnique: orderFindUnique }, $transaction } };

  let service: ResultsService;
  let tenant: TenantContextService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ResultsService, TenantContextService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(ResultsService);
    tenant = moduleRef.get(TenantContextService);
  });

  function runSave(entries: unknown[]) {
    const tx = {
      orderTest: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ status: 'entered' }]),
      },
      order: { update: jest.fn().mockResolvedValue({}) },
    };
    $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));
    orderFindUnique.mockResolvedValue(orderRow());
    const promise = tenant.run(ORG, () => service.saveResults('ord1', { entries: entries as never }));
    return { tx, promise };
  }

  it('rejects saving a result for a test whose sample is not collected (whole batch 400)', async () => {
    const { promise } = runSave([{ orderTestId: 'ot_txt', resultValue: 'trace' }]);
    await expect(promise).rejects.toThrow('has not been collected');
  });

  it('rejects an unknown order test id', async () => {
    const { promise } = runSave([{ orderTestId: 'ot_ghost', resultValue: '5' }]);
    await expect(promise).rejects.toThrow('Unknown order test');
  });

  it('rejects invalid numeric input server-side', async () => {
    const { promise } = runSave([{ orderTestId: 'ot_num', resultValue: 'abc' }]);
    await expect(promise).rejects.toThrow('FBS');
    await expect(promise).rejects.toThrow('valid number');
  });

  it('rejects an option outside snapshottedResultOptions', async () => {
    const { promise } = runSave([{ orderTestId: 'ot_opt', resultValue: 'AB+' }]);
    await expect(promise).rejects.toThrow('A+, A-, B+');
  });

  it('entry path (expectedValue omitted ⇒ null): conditional update only matches a row with no result yet', async () => {
    const { tx, promise } = runSave([{ orderTestId: 'ot_num', resultValue: '92' }]);
    const result = await promise;

    expect(tx.orderTest.updateMany).toHaveBeenCalledWith({
      where: { id: 'ot_num', orderId: 'ord1', status: { notIn: [OrderTestStatus.verified, OrderTestStatus.approved] }, resultValue: null },
      data: expect.objectContaining({ resultValue: '92', status: 'entered', enteredBy: 'system' }),
    });
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].status).toBe('entered');
    expect(result.skipped).toHaveLength(0);
    // Rollup recomputed from the batch.
    expect(tx.orderTest.findMany).toHaveBeenCalledWith({ where: { orderId: 'ord1' }, select: { status: true } });
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id: 'ord1' }, data: { status: expect.any(String) } });
  });

  it('edit path: an entered row updates only when expectedValue matches the stored value', async () => {
    const { tx, promise } = runSave([{ orderTestId: 'ot_num', resultValue: '110', expectedValue: '92' }]);
    const result = await promise;
    expect(tx.orderTest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ resultValue: '92' }) }),
    );
    expect(result.updated[0].resultValue).toBe('110');
  });

  it('CAS miss or verified/approved row → reported as skipped, never silently overwritten, batch continues', async () => {
    const { tx, promise } = runSave([
      { orderTestId: 'ot_num', resultValue: '110', expectedValue: '92' }, // CAS misses (row holds 95 elsewhere)
      { orderTestId: 'ot_opt', resultValue: 'A+' },
    ]);
    tx.orderTest.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const result = await promise;

    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].orderTestId).toBe('ot_num');
    expect(result.skipped[0].reason).toBe('stale');
    expect(result.updated).toHaveLength(1);
    expect(result.updated[0].orderTestId).toBe('ot_opt');
  });

  it('empty resultValue clears the row back to pending (never advances status)', async () => {
    const { tx, promise } = runSave([{ orderTestId: 'ot_num', resultValue: '', expectedValue: '92' }]);
    const result = await promise;
    expect(tx.orderTest.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ resultValue: '92' }) }),
    );
    expect(result.updated[0]).toEqual(
      expect.objectContaining({ orderTestId: 'ot_num', resultValue: null, status: 'pending', enteredBy: null, enteredAt: null }),
    );
  });

  it('no writes → no rollup recompute, order status untouched', async () => {
    const { tx, promise } = runSave([{ orderTestId: 'ot_num', resultValue: '110', expectedValue: '92' }]);
    tx.orderTest.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await promise;
    expect(result.skipped).toHaveLength(1);
    expect(tx.orderTest.findMany).not.toHaveBeenCalled();
    expect(tx.order.update).not.toHaveBeenCalled();
    expect(result.orderStatus).toBe('billed');
  });
});
