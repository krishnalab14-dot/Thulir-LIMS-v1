import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsOptional, Min, ValidateNested } from 'class-validator';
import { PaymentSplitDto } from '../../billing/dto/payment-split.dto';

/**
 * DTO for POST /api/bill-groups/:id/payments — distributes a single payment
 * across the group's linked orders' outstanding balances, oldest-outstanding
 * first (by invoice.totalAmount ASC among those with remaining balance).
 *
 * The splits describe HOW the group payment is made (e.g. ₹800 Cash + ₹200 UPI).
 * The endpoint calculates per-order amounts automatically based on each order's
 * outstanding balance — the caller does not specify per-order allocation.
 */
export class CreateGroupPaymentDto {
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
