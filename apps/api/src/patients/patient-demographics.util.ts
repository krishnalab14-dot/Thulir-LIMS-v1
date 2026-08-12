import { BadRequestException } from '@nestjs/common';

export interface NewPatientIdentity {
  firstName?: string;
  lastName?: string;
  gender?: string;
  mobile?: string;
  dob?: Date | null;
  ageAtRegistration?: number | null;
}

/** Full demographics accepted when registering a new patient (also via orders). */
export interface PatientDemographicsInput extends NewPatientIdentity {
  title?: string | null;
  email?: string | null;
  address?: string | null;
  externalMrn?: string | null;
  abhaNumber?: string | null;
}

/**
 * DOB is the single source of truth: when a DOB is provided the age is derived
 * from it; when only an age is provided it is stored as-is with no DOB.
 */
export function resolveDobAndAge(dob?: Date | null, age?: number | null): { dob: Date | null; age: number | null } {
  if (dob) {
    return { dob, age: ageFromDob(dob) };
  }
  if (age == null || age < 0 || age > 130) {
    throw new BadRequestException('Either a valid date of birth or an age between 0 and 130 is required');
  }
  return { dob: null, age };
}

/** Whole years between a DOB and now (floor). */
export function ageFromDob(dob: Date): number {
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const monthDiff = now.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < dob.getDate())) {
    age -= 1;
  }
  return Math.max(0, age);
}

/**
 * Validates the demographics needed to register a NEW patient (used when an
 * order carries a patient object without a patientId, and by POST /patients).
 */
export function assertNewPatientIdentity(dto: NewPatientIdentity): void {
  if (!dto.firstName || dto.firstName.trim().length === 0) {
    throw new BadRequestException('Patient first name is required');
  }
  if (!dto.lastName || dto.lastName.trim().length === 0) {
    throw new BadRequestException('Patient last name is required');
  }
  if (!dto.gender) {
    throw new BadRequestException('Patient gender is required');
  }
  if (!dto.mobile || dto.mobile.trim().length === 0) {
    throw new BadRequestException('Patient mobile number is required');
  }
}
