import { Prisma } from '@prisma/client';
import { roundMoney } from '../billing/payment.util';

export interface PackageConstituent {
  testId: string;
  testName: string;
  /** The constituent test's standalone MasterTest.currentPrice — used only as a weighting factor. */
  standalonePrice: Prisma.Decimal;
}

export interface DistributedLineItem {
  testId: string;
  testName: string;
  /** This OrderTest row's snapshotted price — a share of the package's own price. */
  price: Prisma.Decimal;
}

/**
 * Distributes a package's OWN price across its constituent tests, proportionally
 * to each test's standalone price, so that the sum of the distributed prices is
 * EXACTLY the package price (2dp-exact).
 *
 * Why this exists: `MasterTestPackage.packagePrice` is the authoritative billing
 * price for a package (a bundled panel is priced independently of its parts).
 * But Result Entry (Stage 2) needs one `OrderTest` row per constituent test to
 * record per-test results, so the package price is split across those rows.
 * The split is a pure accounting distribution: each row keeps a meaningful
 * per-test snapshot, and the order/invoice totals always reflect `packagePrice`,
 * never the sum of standalone `currentPrice` values.
 *
 * The residual caused by 2dp rounding is applied to the largest share, so the
 * distributed values sum to `packagePrice` with no drift (snapshot principle).
 */
export function distributePackagePrice(
  packagePrice: Prisma.Decimal,
  items: PackageConstituent[],
): DistributedLineItem[] {
  if (items.length === 0) {
    return [];
  }

  const totalStandalone = items.reduce((acc, i) => acc.plus(i.standalonePrice), new Prisma.Decimal(0));

  let shares: Prisma.Decimal[];
  if (totalStandalone.isZero()) {
    // Degenerate case (all constituents free): split evenly, last row absorbs rounding.
    const base = packagePrice.div(items.length);
    shares = items.map((_, idx) => (idx === items.length - 1 ? packagePrice.minus(base.mul(items.length - 1)) : base));
  } else {
    shares = items.map((i) => roundMoney(packagePrice.mul(i.standalonePrice).div(totalStandalone)));
    // Re-apply the rounding residual to the largest share so the sum is exact.
    const residual = packagePrice.minus(shares.reduce((acc, s) => acc.plus(s), new Prisma.Decimal(0)));
    if (!residual.isZero()) {
      let maxIdx = 0;
      shares.forEach((s, idx) => {
        if (s.greaterThan(shares[maxIdx])) maxIdx = idx;
      });
      shares[maxIdx] = roundMoney(shares[maxIdx].plus(residual));
    }
  }

  return items.map((i, idx) => ({ testId: i.testId, testName: i.testName, price: shares[idx] }));
}
