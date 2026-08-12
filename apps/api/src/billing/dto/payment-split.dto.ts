import { PaymentMode } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsIn, IsNumber, Min } from 'class-validator';

export class PaymentSplitDto {
  @IsIn(Object.values(PaymentMode))
  mode!: PaymentMode;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}
