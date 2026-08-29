import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrgSettingsDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  nablAccreditationNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  gstNumber?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  logoUrl?: string | null;
}
