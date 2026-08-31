import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Gender, ResultType } from '@prisma/client';

/**
 * Nested specification for age/sex overrides — mirrors CreateTestDto's version.
 * Each row defines a refLow/refHigh pair scoped to a sex tier and age band.
 */
export class UpdateTestSpecificationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ageMinYears?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ageMaxYears?: number;

  @IsOptional()
  @IsIn([null, ...Object.values(Gender)])
  sex?: Gender | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  refLow?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  refHigh?: number;
}

/**
 * PATCH /masters/tests/:id — every field is optional for partial updates.
 * When `specifications` is provided, the entire set replaces the old one
 * (same upsert-replace pattern as create).
 */
export class UpdateTestDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  testCode?: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  testName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  currentPrice?: number;

  @IsOptional()
  @IsString()
  requiredSampleTypeId?: string | null;

  @IsOptional()
  @IsBoolean()
  requiresDedicatedSample?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  unit?: string | null;

  @IsOptional()
  @IsIn(Object.values(ResultType))
  resultType?: ResultType;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resultOptions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resultOptionsAbnormal?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  defaultRefLow?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  defaultRefHigh?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  criticalLow?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  criticalHigh?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateTestSpecificationDto)
  specifications?: UpdateTestSpecificationDto[];
}
