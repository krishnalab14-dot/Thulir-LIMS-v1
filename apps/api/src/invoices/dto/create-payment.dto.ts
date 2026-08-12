import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator';
import { PaymentSplitDto } from '../../billing/dto/payment-split.dto';

export class CreatePaymentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentSplitDto)
  splits!: PaymentSplitDto[];

  /** Optional explicit total; when present, sum(splits) must equal it. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;
}
