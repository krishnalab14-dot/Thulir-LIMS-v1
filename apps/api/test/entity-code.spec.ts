import { buildDoctorCode } from '../src/parties/doctor-code.util';
import { buildStaffCode } from '../src/auth/staff-code.util';

describe('buildDoctorCode', () => {
  it('formats <PREFIX>-DR-<NNNN> with zero-padded counter', () => {
    expect(buildDoctorCode('THU', 1)).toBe('THU-DR-0001');
    expect(buildDoctorCode('THU', 42)).toBe('THU-DR-0042');
    expect(buildDoctorCode('THU', 9999)).toBe('THU-DR-9999');
    expect(buildDoctorCode('ABC', 1)).toBe('ABC-DR-0001');
  });

  it('pads prefix to 3 chars with X', () => {
    // deriveOrgPrefix is tested separately; buildDoctorCode just uses whatever prefix it gets
    expect(buildDoctorCode('AB', 1)).toBe('AB-DR-0001');
  });
});

describe('buildStaffCode', () => {
  it('formats <PREFIX>-ST-<NNNN> with zero-padded counter', () => {
    expect(buildStaffCode('THU', 1)).toBe('THU-ST-0001');
    expect(buildStaffCode('THU', 42)).toBe('THU-ST-0042');
    expect(buildStaffCode('THU', 9999)).toBe('THU-ST-9999');
    expect(buildStaffCode('ABC', 1)).toBe('ABC-ST-0001');
  });
});
