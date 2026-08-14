import { IsNotEmpty, IsString, Matches } from 'class-validator';

/**
 * GET /api/public/verify-report — BOTH fields required. The order number is
 * the order's deterministic verification code (THU-VR-…, printed on the
 * report and encoded in its QR); dob is the patient's date of birth in
 * YYYY-MM-DD — the second factor that makes the printed QR scannable without
 * leaking results (see the public-verify service docs).
 */
export class VerifyReportQueryDto {
  @IsString()
  @IsNotEmpty()
  orderNumber!: string;

  @IsString()
  @IsNotEmpty()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dob must be in YYYY-MM-DD format' })
  dob!: string;
}
