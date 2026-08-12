import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CheckDuplicateQueryDto {
  /** Exact spec surface: ?mobile=<number>. */
  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobile?: string;

  /** Free-text term matched against name / MRN / patientUid (registration search box). */
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;
}
