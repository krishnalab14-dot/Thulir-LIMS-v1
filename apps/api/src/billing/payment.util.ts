import { BadRequestException } from '@nestjs/common';
import { InvoiceStatus, PaymentMode, Prisma } from '@prisma/client';

export interface PaymentSplitInput {
  mode: PaymentMode;
  amount: number;
}

export interface NormalizedSplit {
  mode: PaymentMode;
  amount: Prisma.Decimal;
}

const VALID_MODES = new Set<PaymentMode>(Object.values(PaymentMode));

/** Round a money value to 2 decimals (half-up). */
export function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Validates and normalizes a payment split list:
 *  - at least one split
 *  - every mode must be a known PaymentMode
 *  - every amount must be a finite positive number
 * Returns Decimal-backed splits for exact arithmetic.
 */
export function normalizeAndValidateSplits(splits: PaymentSplitInput[] | null | undefined): NormalizedSplit[] {
  if (!splits || splits.length === 0) {
    throw new BadRequestException('At least one payment split is required');
  }
  return splits.map((split, index) => {
    if (!VALID_MODES.has(split.mode)) {
      throw new BadRequestException(`Invalid payment mode at split ${index + 1}`);
    }
    const amount = new Prisma.Decimal(split.amount);
    if (!amount.isFinite() || !amount.greaterThan(0)) {
      throw new BadRequestException(`Split ${index + 1} amount must be a positive number`);
    }
    return { mode: split.mode, amount: roundMoney(amount) };
  });
}

/** Sum of normalized split amounts (exact Decimal arithmetic). */
export function sumSplits(splits: NormalizedSplit[]): Prisma.Decimal {
  return splits.reduce((acc, split) => acc.plus(split.amount), new Prisma.Decimal(0));
}

/**
 * Derives Invoice.status from cumulative paid vs. invoice total:
 *  paid ≥ total → 'paid'; paid > 0 → 'partial'; otherwise 'due'.
 */
export function deriveInvoiceStatus(paid: Prisma.Decimal, total: Prisma.Decimal): InvoiceStatus {
  if (paid.greaterThanOrEqualTo(total)) {
    return 'paid';
  }
  if (paid.greaterThan(0)) {
    return 'partial';
  }
  return 'due';
}
