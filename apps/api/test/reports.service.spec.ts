import { Test } from '@nestjs/testing';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/prisma/tenant-context.service';
import { ReportsService } from '../src/reports/reports.service';

const ORG = 'org_demo';

function approvedOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ord1',
    organizationId: ORG,
    status: 'approved',
    isUrgent: false,
    createdAt: new Date('2026-08-14T08:00:00Z'),
    reportGeneratedAt: null,
    organization: { id: ORG, name: 'Thulir Demo Lab' },
    patient: { patientUid: 'THU-2026-0001', firstName: 'Ravi', lastName: 'Kumar', gender: 'male', dob: new Date('1990-01-01'), ageAtRegistration: null },
    samples: [
      {
        id: 's1',
        barcodeValue: 'ORD1-SERUM',
        sampleType: { id: 'st1', name: 'Serum', code: 'SERUM' },
        orderTests: [
          {
            id: 'ot_approved_1',
            testNameSnapshot: 'FBS',
            status: 'approved',
            snapshottedResultType: 'numeric',
            snapshottedResultOptions: null,
            snapshottedResultOptionsAbnormal: [],
            snapshottedRefLow: 70,
            snapshottedRefHigh: 99,
            snapshottedCriticalLow: 40,
            snapshottedCriticalHigh: 400,
            snapshottedUnit: 'mg/dL',
            resultValue: '92',
            enteredBy: 'system',
            enteredAt: new Date(),
            verifiedBy: 'system',
            verifiedAt: new Date(),
            verifyRejectedNote: null,
            approvedBy: 'system',
            approvedAt: new Date(),
            approvalSignatureStamp: 'AABBCCDD00112233',
          },
          {
            id: 'ot_approved_2',
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
            enteredBy: 'system',
            enteredAt: new Date(),
            verifiedBy: 'system',
            verifiedAt: new Date(),
            verifyRejectedNote: null,
            approvedBy: 'system',
            approvedAt: new Date(),
            approvalSignatureStamp: 'FFEEDDCC99887766',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('ReportsService (mock-based unit coverage; real-DB e2e covers the HTTP contract)', () => {
  const orderFindUnique = jest.fn();
  const orderUpdate = jest.fn();
  const prismaMock = { prisma: { order: { findUnique: orderFindUnique, update: orderUpdate } } };

  let service: ReportsService;
  let tenant: TenantContextService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ReportsService, TenantContextService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(ReportsService);
    tenant = moduleRef.get(TenantContextService);
  });

  it('report returns the full payload for a fully-approved order and stamps reportGeneratedAt once', async () => {
    orderFindUnique.mockResolvedValue(approvedOrderRow());
    orderUpdate.mockResolvedValue({});

    const report = await tenant.run(ORG, () => service.getReport('ord1'));

    const rows = report.samples[0].orderTests;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: 'ot_approved_1',
        status: 'approved',
        resultValue: '92',
        unit: 'mg/dL',
        refLow: 70,
        refHigh: 99,
        approvedBy: 'system',
        approvalSignatureStamp: 'AABBCCDD00112233',
      }),
    );
    expect(report.patient).toEqual(expect.objectContaining({ patientUid: 'THU-2026-0001', firstName: 'Ravi', ageYears: expect.any(Number) }));
    expect(report.lab).toEqual({ labName: 'Thulir Demo Lab', labAddress: null });
    expect(report.signature.stamp).toBe('AABBCCDD00112233');
    expect(report.verify.code).toMatch(/^THU-VR-[0-9A-Z]+-[0-9A-F]{4}$/);
    expect(report.verify.path).toBe(`/verify-report?orderNumber=${encodeURIComponent(report.verify.code)}`);

    // reportGeneratedAt was null → stamped now, once.
    expect(report.order.reportGeneratedAt).toBeInstanceOf(Date);
    expect(orderUpdate).toHaveBeenCalledWith({ where: { id: 'ord1' }, data: { reportGeneratedAt: expect.any(Date) } });
  });

  it('report does NOT re-stamp reportGeneratedAt when it was already set (issued once)', async () => {
    orderFindUnique.mockResolvedValue(approvedOrderRow({ reportGeneratedAt: new Date('2026-08-14T10:00:00Z') }));
    const report = await tenant.run(ORG, () => service.getReport('ord1'));
    expect(report.order.reportGeneratedAt).toEqual(new Date('2026-08-14T10:00:00Z'));
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('report throws a 409-style conflict when any test is not approved, naming the test', async () => {
    orderFindUnique.mockResolvedValue(
      approvedOrderRow({
        samples: [
          {
            id: 's1',
            barcodeValue: 'ORD1-SERUM',
            sampleType: { id: 'st1', name: 'Serum', code: 'SERUM' },
            orderTests: [
              { ...approvedOrderRow().samples[0].orderTests[0] },
              { ...approvedOrderRow().samples[0].orderTests[1], status: 'verified', approvedBy: null, approvedAt: null, approvalSignatureStamp: null },
            ],
          },
        ],
      }),
    );
    await expect(tenant.run(ORG, () => service.getReport('ord1'))).rejects.toThrow("1 result is still awaiting approval: 'HbA1c'");
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('report throws NotFound for an unknown order', async () => {
    orderFindUnique.mockResolvedValue(null);
    await expect(tenant.run(ORG, () => service.getReport('ghost'))).rejects.toThrow('Order not found');
  });
});
