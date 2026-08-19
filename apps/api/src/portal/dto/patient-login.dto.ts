import { IsDateString, IsString, Matches } from 'class-validator';

/**
 * POST /api/portal/patient/login — mobile + DOB.
 * Mobile is normalized to digits only (strips spaces, dashes, country code
 * prefix like +91 → 91 → trimmed — the same normalization the patient
 * registration applies at write time, so matching is exact).
 */
export class PatientLoginDto {
  @IsString()
  @Matches(/^\d{7,15}$/, { message: 'Mobile must be 7–15 digits' })
  mobile!: string;

  @IsDateString({}, { message: 'dob must be a valid ISO date (YYYY-MM-DD)' })
  dob!: string;
}
