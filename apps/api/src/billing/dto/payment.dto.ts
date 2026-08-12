import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator';
import { PaymentSplitDto } from './payment-split.dto';

export class PaymentDto {
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentSplitDto)
  splits?: PaymentSplitDto[];

  /**
   * Optional total being paid. When present the server rejects the payment if
   * sum(splits) !== amount (exact split-sum validation). When absent the sum
   * of the splits is used — the request shape our frontend sends.
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount?: number;
}
