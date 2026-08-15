import { IsIn, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '@prisma/client';

/**
 * Admin-only staff creation (POST /api/users) — adding a user to an EXISTING
 * organization. This is deliberately NOT the same as the public register
 * endpoint (which bootstraps a brand-new org); a public route must never
 * double as "add any user to any org".
 */
export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;

  @IsIn(Object.values(Role))
  role!: Role;
}
