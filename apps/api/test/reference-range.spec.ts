import { Gender } from '@prisma/client';
import { patientAgeYears, resolveReferenceRange, specificationsOverlap } from '../src/masters/reference-range.util';

const M = Gender.male;
const F = Gender.female;

describe('reference-range resolution (§2)', () => {
  const defaults = { defaultRefLow: 10, defaultRefHigh: 20 };

  it('rule 1: an exact age+sex specification wins over any-sex and defaults', () => {
    const specs = [
      { ageMinYears: 0, ageMaxYears: 12, sex: null, refLow: 5, refHigh: 15 },
      { ageMinYears: 13, ageMaxYears: 65, sex: M, refLow: 30, refHigh: 40 },
      { ageMinYears: 13, ageMaxYears: 65, sex: null, refLow: 1, refHigh: 2 },
    ];
    const r = resolveReferenceRange(specs, defaults, 30, M)!;
    expect(r).toEqual({ refLow: 30, refHigh: 40, source: 'spec' });
  });

  it('rule 2: no exact-sex match → the any-sex specification for the age range', () => {
    const specs = [
      { ageMinYears: 13, ageMaxYears: 65, sex: M, refLow: 30, refHigh: 40 },
      { ageMinYears: 13, ageMaxYears: 65, sex: null, refLow: 1, refHigh: 2 },
    ];
    const r = resolveReferenceRange(specs, defaults, 30, F)!;
    expect(r).toEqual({ refLow: 1, refHigh: 2, source: 'spec' });
  });

  it('rule 3: no matching spec → the default range', () => {
    const r = resolveReferenceRange([{ ageMinYears: 0, ageMaxYears: 5, sex: null, refLow: 5, refHigh: 15 }], defaults, 30, M)!;
    expect(r).toEqual({ refLow: 10, refHigh: 20, source: 'default' });
  });

  it('age bounds are inclusive', () => {
    const specs = [{ ageMinYears: 18, ageMaxYears: 60, sex: null, refLow: 5, refHigh: 15 }];
    expect(resolveReferenceRange(specs, defaults, 18, M)?.source).toBe('spec');
    expect(resolveReferenceRange(specs, defaults, 60, M)?.source).toBe('spec');
    expect(resolveReferenceRange(specs, defaults, 17, M)?.source).toBe('default');
    expect(resolveReferenceRange(specs, defaults, 61, M)?.source).toBe('default');
  });

  it('rule 4: no spec and no complete default range → null (caller rejects the order)', () => {
    expect(resolveReferenceRange([], { defaultRefLow: null, defaultRefHigh: null }, 30, M)).toBeNull();
    expect(resolveReferenceRange([], { defaultRefLow: 10, defaultRefHigh: null }, 30, M)).toBeNull();
    expect(resolveReferenceRange([], { defaultRefLow: null, defaultRefHigh: 20 }, 30, M)).toBeNull();
    // A default WITH both bounds resolves even with zero specs.
    expect(resolveReferenceRange([], defaults, 30, M)?.source).toBe('default');
  });
});

describe('TestSpecification overlap validation (Masters-side)', () => {
  it('same sex tier + overlapping age ranges → overlap', () => {
    expect(specificationsOverlap(
      { ageMinYears: 13, ageMaxYears: 65, sex: M, refLow: 1, refHigh: 2 },
      { ageMinYears: 40, ageMaxYears: 80, sex: M, refLow: 3, refHigh: 4 },
    )).toBe(true);
  });

  it('same any-sex tier + overlapping age ranges → overlap', () => {
    expect(specificationsOverlap(
      { ageMinYears: 0, ageMaxYears: 12, sex: null, refLow: 1, refHigh: 2 },
      { ageMinYears: 10, ageMaxYears: 20, sex: null, refLow: 3, refHigh: 4 },
    )).toBe(true);
  });

  it('different sex tiers never overlap (exact-sex vs any-sex is disambiguated at runtime)', () => {
    expect(specificationsOverlap(
      { ageMinYears: 0, ageMaxYears: 12, sex: M, refLow: 1, refHigh: 2 },
      { ageMinYears: 5, ageMaxYears: 10, sex: null, refLow: 3, refHigh: 4 },
    )).toBe(false);
    expect(specificationsOverlap(
      { ageMinYears: 0, ageMaxYears: 12, sex: M, refLow: 1, refHigh: 2 },
      { ageMinYears: 0, ageMaxYears: 12, sex: F, refLow: 3, refHigh: 4 },
    )).toBe(false);
  });

  it('disjoint age ranges never overlap', () => {
    expect(specificationsOverlap(
      { ageMinYears: 0, ageMaxYears: 12, sex: null, refLow: 1, refHigh: 2 },
      { ageMinYears: 13, ageMaxYears: 20, sex: null, refLow: 3, refHigh: 4 },
    )).toBe(false);
  });
});

describe('patientAgeYears', () => {
  it('uses DOB as the source of truth when present (recomputed at order time)', () => {
    const dob = new Date();
    dob.setFullYear(dob.getFullYear() - 30);
    expect(patientAgeYears({ dob, ageAtRegistration: 30 })).toBe(30);
  });

  it('falls back to ageAtRegistration when no DOB was captured', () => {
    expect(patientAgeYears({ dob: null, ageAtRegistration: 45 })).toBe(45);
    expect(patientAgeYears({ dob: null, ageAtRegistration: null })).toBe(0);
  });
});
