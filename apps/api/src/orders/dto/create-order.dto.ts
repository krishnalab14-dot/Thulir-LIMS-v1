import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNotEmptyObject,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaymentDto } from '../../billing/dto/payment.dto';
import { GENDERS, GenderValue } from '../../patients/dto/create-patient.dto';

export class OrderPatientDto {
  /** Existing patient id — when present the order links to it (demographics ignored). */
  @IsOptional()
  @IsString()
  patientId?: string;

  // New-patient demographics (required when patientId is absent).
  @IsOptional()
  @IsString()
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dob?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(130)
  ageAtRegistration?: number;

  @Transform(({ value }) => (typeof value === 'string' ? value.toLowerCase() : value))
  @IsOptional()
  @IsIn(GENDERS)
  gender?: GenderValue;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  mobile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  externalMrn?: string;
}

export class OrderDetailsDto {
  @IsOptional()
  @IsString()
  referrerPartyId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  clinicalNotes?: string;

  @IsOptional()
  @IsBoolean()
  isUrgent?: boolean;

  /** Informational — when the patient/referrer can expect the report. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expectedReportDate?: Date;
}

export class BillingDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountPercent?: number;

  /**
   * Defense-in-depth (deliberately kept in the DTO): our frontend never sends
   * these, but if a future frontend version does, the server recomputes them
   * independently and rejects on mismatch instead of trusting the client.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  subtotal?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  total?: number;
}

export class CreateOrderDto {
  @IsNotEmptyObject()
  @ValidateNested()
  @Type(() => OrderPatientDto)
  patient!: OrderPatientDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => OrderDetailsDto)
  orderDetails?: OrderDetailsDto;

  @IsOptional()
  @IsString({ each: true })
  testIds?: string[];

  @IsOptional()
  @IsString({ each: true })
  packageIds?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => BillingDto)
  billing?: BillingDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PaymentDto)
  payment?: PaymentDto;
}
