import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * First registration for a brand-new organization: creates the Organization
 * AND its first User (role admin) in one transaction. Usernames are globally
 * unique — a username resolves to exactly one user, so login has no "which
 * org am I logging into" ambiguity.
 */
export class RegisterDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  organizationName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  username!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(100)
  password!: string;
}
