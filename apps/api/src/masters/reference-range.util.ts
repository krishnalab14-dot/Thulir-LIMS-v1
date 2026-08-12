import { Gender } from '@prisma/client';
import { ageFromDob } from '../patients/patient-demographics.util';

/** A TestSpecification row, as consumed by the resolver (sex null = any sex). */
export interface SpecLike {
  ageMinYears: number;
  ageMaxYears: number;
  sex: Gender | null;
  refLow: number;
  refHigh: number;
}

export interface ResolvedRange {
  refLow: number;
  refHigh: number;
  /** Where the resolved range came from — a matching spec, or the test default. */
  source: 'spec' | 'default';
}

/**
 * §2 range-resolution rule for a numeric test, given the patient's age in
 * years and sex:
 *   1. a TestSpecification matching the age range AND the exact sex → use it;
 *   2. else a TestSpecification matching the age range with sex = null (any) → use it;
 *   3. else the test's defaultRefLow/defaultRefHigh → use it;
 *   4. else NO valid range — the caller rejects the order (never snapshots
 *      a null/undefined range).
 * Age bounds are inclusive ([ageMinYears, ageMaxYears]).
 * Returns null when neither a spec nor a complete default range resolves.
 */
export function resolveReferenceRange(
  specs: SpecLike[],
  defaults: { defaultRefLow: number | null; defaultRefHigh: number | null },
  ageYears: number,
  sex: Gender,
): ResolvedRange | null {
  const inAge = (s: SpecLike): boolean => ageYears >= s.ageMinYears && ageYears <= s.ageMaxYears;

  const exact = specs.find((s) => s.sex === sex && inAge(s));
  if (exact) {
    return { refLow: exact.refLow, refHigh: exact.refHigh, source: 'spec' };
  }

  const anySex = specs.find((s) => s.sex === null && inAge(s));
  if (anySex) {
    return { refLow: anySex.refLow, refHigh: anySex.refHigh, source: 'spec' };
  }

  if (defaults.defaultRefLow != null && defaults.defaultRefHigh != null) {
    return { refLow: defaults.defaultRefLow, refHigh: defaults.defaultRefHigh, source: 'default' };
  }

  return null;
}

/**
 * Overlap check (Masters side, creation-time): two specifications for the SAME
 * test conflict when they share the same sex resolution tier — both any-sex
 * (sex = null) or the same exact sex — AND their age ranges intersect. The
 * runtime rule never has to disambiguate between tiers (exact-sex wins over
 * any-sex), so only same-tier overlaps are ambiguous and rejected.
 */
export function specificationsOverlap(a: SpecLike, b: SpecLike): boolean {
  const sameSexTier = (a.sex === null && b.sex === null) || (a.sex !== null && b.sex !== null && a.sex === b.sex);
  if (!sameSexTier) {
    return false;
  }
  return a.ageMinYears <= b.ageMaxYears && b.ageMinYears <= a.ageMaxYears;
}

/**
 * The patient's age in whole years at THIS moment — DOB is the source of
 * truth (recomputed now, so a repeat patient's age tracks time since their
 * DOB); when no DOB was captured, the stored ageAtRegistration is used.
 */
export function patientAgeYears(patient: { dob: Date | null; ageAtRegistration: number | null }): number {
  if (patient.dob) {
    return ageFromDob(patient.dob);
  }
  return patient.ageAtRegistration ?? 0;
}
