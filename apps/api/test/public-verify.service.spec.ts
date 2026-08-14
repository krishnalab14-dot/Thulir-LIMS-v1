import { Test } from '@nestjs/testing';
import { verificationCode } from '../src/common/report-code.util';
import { PrismaService } from '../src/prisma/prisma.service';
import { PublicVerifyService } from '../src/public-verify/public-verify.service';

/**
 * PublicVerifyService deliberately has NO tenant dependency — it is the one
 * allowlisted tenant-free lookup (raw client, globally-unique order numbers,
 * minimal response). Its unit tests therefore don't wrap calls in a tenant
 * context; that is the point.
 */
describe('PublicVerifyService (mock-based unit coverage; real-DB e2e covers the HTTP contract)', () => {
  // Realistic cuid-like id: lowercase alphanumeric, no underscores (the
  // verification-code regex allows [0-9A-Z] only).
  const ORDER_ID = 'cmabcd1234567890abcdefgh';
  const CODE = verificationCode(ORDER_ID);
  const DOB = '1985-01-01';

  const orderFindMany = jest.fn();
  const orderFindUnique = jest.fn();
  const orderTestFindMany = jest.fn();
  const prismaMock = {
    raw: { order: { findMany: orderFindMany, findUnique: orderFindUnique }, orderTest: { findMany: orderTestFindMany } },
  };

  let service: PublicVerifyService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [PublicVerifyService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(PublicVerifyService);
  });

  function mockOrder(overrides: Record<string, unknown> = {}) {
    return {
      id: ORDER_ID,
      status: 'approved',
      reportGeneratedAt: new Date('2026-08-14T09:00:00Z'),
      organization: { name: 'Thulir Demo Lab' },
      patient: { dob: new Date(`${DOB}T00:00:00.000Z`) },
      ...overrides,
    };
  }

  it('valid code + correct DOB → the exact minimal payload (no extra keys)', async () => {
    orderFindMany.mockResolvedValue([mockOrder()]);
    orderTestFindMany.mockResolvedValue([{ approvedAt: new Date() }, { approvedAt: new Date() }]);

    const result = await service.verifyReport({ orderNumber: CODE, dob: DOB });
    expect(result).toEqual({
      valid: true,
      orderNumber: CODE,
      labName: 'Thulir Demo Lab',
      reportDate: '2026-08-14',
    });
    expect(Object.keys(result).sort()).toEqual(['labName', 'orderNumber', 'reportDate', 'valid']);
    // The prefix lookup is by the code's 8-char id prefix (lowercased).
    expect(orderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { startsWith: ORDER_ID.slice(0, 8) } } }),
    );
  });

  it('wrong DOB, not-approved order, and unknown code are byte-identical { valid: false }', async () => {
    // Wrong DOB: the order resolves and is approved, the DOB check fails.
    orderFindMany.mockResolvedValue([mockOrder()]);
    orderTestFindMany.mockResolvedValue([{ approvedAt: new Date() }, { approvedAt: new Date() }]);
    const wrongDob = await service.verifyReport({ orderNumber: CODE, dob: '1999-09-09' });
    expect(wrongDob).toEqual({ valid: false });

    // Unknown code: no candidate rows at all.
    orderFindMany.mockResolvedValue([]);
    const unknownCode = await service.verifyReport({ orderNumber: 'THU-VR-XXXXXXXX-0000', dob: DOB });
    expect(unknownCode).toEqual({ valid: false });

    // Not approved → same shape even though the code resolves.
    orderFindMany.mockResolvedValue([mockOrder({ status: 'partially_approved' })]);
    orderTestFindMany.mockResolvedValue([{ approvedAt: new Date() }, { approvedAt: null }]);
    const notApproved = await service.verifyReport({ orderNumber: CODE, dob: DOB });
    expect(notApproved).toEqual({ valid: false });

    expect(JSON.stringify(wrongDob)).toBe(JSON.stringify(unknownCode));
    expect(JSON.stringify(unknownCode)).toBe(JSON.stringify(notApproved));
  });

  it('a patient registered by age (no dob) can never verify — fail-closed', async () => {
    orderFindMany.mockResolvedValue([mockOrder({ patient: { dob: null } })]);
    orderTestFindMany.mockResolvedValue([{ approvedAt: new Date() }]);
    const result = await service.verifyReport({ orderNumber: CODE, dob: DOB });
    expect(result).toEqual({ valid: false });
  });

  it('reportDate falls back to the latest approval when the report was never generated', async () => {
    const approvedAt = new Date('2026-08-13T15:00:00Z');
    orderFindMany.mockResolvedValue([mockOrder({ reportGeneratedAt: null })]);
    orderTestFindMany.mockResolvedValue([{ approvedAt: new Date('2026-08-12T09:00:00Z') }, { approvedAt }]);
    const result = await service.verifyReport({ orderNumber: CODE, dob: DOB });
    expect(result).toEqual(expect.objectContaining({ valid: true, reportDate: '2026-08-13' }));
  });

  it('malformed order numbers resolve to nothing (no crash, same shape)', async () => {
    const malformed = await service.verifyReport({ orderNumber: 'not-a-code', dob: DOB });
    expect(malformed).toEqual({ valid: false });
    // Raw-id fallback path: findUnique by the exact id.
    orderFindUnique.mockResolvedValue(mockOrder());
    orderTestFindMany.mockResolvedValue([{ approvedAt: new Date() }]);
    const rawId = await service.verifyReport({ orderNumber: ORDER_ID, dob: DOB });
    expect(rawId).toEqual(expect.objectContaining({ valid: true, orderNumber: CODE }));
  });
});
