import { Prisma } from '@prisma/client';
import { roundMoney } from '../billing/payment.util';

/** total = subtotal − subtotal × (discountPercent / 100), rounded to 2dp. */
export function computeOrderTotal(subtotal: Prisma.Decimal, discountPercent: Prisma.Decimal): Prisma.Decimal {
  const discount = subtotal.mul(discountPercent).div(100);
  return roundMoney(subtotal.minus(discount));
}
