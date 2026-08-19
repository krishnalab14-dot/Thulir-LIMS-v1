import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /api/parties/:id/portal-access — admin/lab_manager generates or
 * resets a referrer's portal credentials. The returned password is shown
 * ONCE and never stored in plaintext (§2).
 */
export class GeneratePortalAccessDto {
  /** Optional custom username. If omitted, auto-generated from party name. */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(30)
  username?: string;
}
