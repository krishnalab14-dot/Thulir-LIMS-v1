import { Transform, Type } from 'class-transformer';
import {
  IsDate,
  IsEmail,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const GENDERS = ['male', 'female', 'other'] as const;
export type GenderValue = (typeof GENDERS)[number];

export class CreatePatientDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  title?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  lastName!: string;

  /** Primary source of truth — when present, ageAtRegistration is derived. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dob?: Date;

  /** Fallback when only age is given (no DOB). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(130)
  ageAtRegistration?: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsIn(GENDERS)
  gender!: GenderValue;

  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  mobile!: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(200)
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  externalMrn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  abhaNumber?: string;
}
