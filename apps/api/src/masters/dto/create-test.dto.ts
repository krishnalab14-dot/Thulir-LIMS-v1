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

export class TestSpecificationDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  ageMinYears!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  ageMaxYears!: number;

  /** null = applies to any sex. Reuses Patient's Gender enum (value set identical to the spec's proposed Sex). */
  @IsOptional()
  @IsIn(Object.values(Gender))
  sex?: Gender;

  @Type(() => Number)
  @IsNumber()
  refLow!: number;

  @Type(() => Number)
  @IsNumber()
  refHigh!: number;
}

export class CreateTestDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  testCode!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  testName!: string;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  currentPrice!: number;

  @IsOptional()
  @IsString()
  requiredSampleTypeId?: string;

  // Stage 2.1 per-test override: true ⇒ this test always gets its own
  // dedicated Sample/tube, even when another test on the same order shares
  // its sample type. Defaults false (shares a tube, as in Stage 2).
  @IsOptional()
  @IsBoolean()
  requiresDedicatedSample?: boolean;

  // --- Stage 2.5 Test Master extension ---

  @IsOptional()
  @IsIn(Object.values(ResultType))
  resultType?: ResultType;

  /** Valid choice list — only meaningful (and required non-empty) when resultType = options. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resultOptions?: string[];

  /**
   * Stage 3: parallel array marking which resultOptions are ABNORMAL (e.g. a
   * qualitative "Positive"). Only meaningful when resultType = options; each
   * entry must be one of resultOptions (validated in the service). Result
   * Entry uses it for visual flagging and "Mark All Normal" (fills with the
   * first non-abnormal option). Purely additive — resultOptions itself is
   * unchanged.
   */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resultOptionsAbnormal?: string[];

  /** Default reference range — used when no age/sex specification matches (§2 rule 3). */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  defaultRefLow?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  defaultRefHigh?: number;

  /** Critical thresholds — captured now, consumed by a later alerting stage. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  criticalLow?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  criticalHigh?: number;

  /** Age/sex-scoped reference ranges — overlap-validated at save time (§2). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestSpecificationDto)
  specifications?: TestSpecificationDto[];
}
