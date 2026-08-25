import { buildBillNo, nextBillNo } from '../src/orders/bill-no.util';

describe('billNo generation', () => {
  it('formats consistently with the patientUid pattern, with an explicit BILL segment', () => {
    expect(buildBillNo('THU', 2026, 1)).toBe('THU-BILL-2026-0001');
    expect(buildBillNo('THU', 2026, 42)).toBe('THU-BILL-2026-0042');
    expect(buildBillNo('THU', 2026, 1234)).toBe('THU-BILL-2026-1234');
  });

  it('reuses the atomic UidCounter pattern under a SEPARATE bill namespace', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ counter: 3n }]);
    const tx = { $queryRaw } as never;

    const billNo = await nextBillNo(tx, { id: 'org_demo', name: 'Thulir Demo Lab' }, 2026);

    expect(billNo).toBe('THU-BILL-2026-0003');
    // Same single-statement ON CONFLICT ... RETURNING upsert as patientUid —
    // concurrent order creations serialize on the row lock.
    const raw = $queryRaw.mock.calls[0][0];
    const sql = String((raw as { text?: string })?.text ?? raw);
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('RETURNING');
    // The counter key must be the bill namespace (orgId:bill:year), NOT the
    // patientUid namespace (orgId:year) — the two sequences stay independent.
    // $queryRaw receives the template + interpolated values as its call args.
    const callArgs = $queryRaw.mock.calls[0] as unknown[];
    expect(callArgs).toContain('org_demo:bill:2026');
  });
});
