import { buildPatientUid, deriveOrgPrefix, nextPatientUid } from '../src/patients/patient-uid.util';

describe('patientUid generation', () => {
  it('derives a 3-letter org prefix from the organization name', () => {
    expect(deriveOrgPrefix('Thulir Demo Lab')).toBe('THU');
    expect(deriveOrgPrefix('A')).toBe('AXX');
    expect(deriveOrgPrefix('123 Labs')).toBe('LAB');
  });

  it('formats the sequential uid as <PREFIX>-<YEAR>-<4-digit counter>', () => {
    expect(buildPatientUid('THU', 2026, 1)).toBe('THU-2026-0001');
    expect(buildPatientUid('THU', 2026, 12)).toBe('THU-2026-0012');
    expect(buildPatientUid('THU', 2026, 1234)).toBe('THU-2026-1234');
  });

  it('is collision-safe under concurrent registration (single atomic ON CONFLICT upsert)', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([{ counter: 7n }]);
    const tx = { $queryRaw } as never;

    const uid = await nextPatientUid(tx, { id: 'org_demo', name: 'Thulir Demo Lab' }, 2026);

    expect(uid).toBe('THU-2026-0007');
    // The counter is incremented in ONE statement with ON CONFLICT, so two
    // concurrent registrations serialize on the row lock — no read-modify-write
    // race that could hand out the same number twice.
    const raw = $queryRaw.mock.calls[0][0];
    expect(String((raw as { text?: string })?.text ?? raw)).toContain('ON CONFLICT');
    expect(String((raw as { text?: string })?.text ?? raw)).toContain('RETURNING');
  });
});
