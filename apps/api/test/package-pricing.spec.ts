import { Prisma } from '@prisma/client';
import { distributePackagePrice } from '../src/orders/package-pricing.util';

function d(n: string | number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

describe('distributePackagePrice — package bills at its own price', () => {
  it('distributes proportionally and sums EXACTLY to the package price (900 over 700/500)', () => {
    const out = distributePackagePrice(d(900), [
      { testId: 't_a', testName: 'A', standalonePrice: d(700) },
      { testId: 't_b', testName: 'B', standalonePrice: d(500) },
    ]);
    // 900 × 700/1200 = 525 · 900 × 500/1200 = 375 (standalone sum would be 1200)
    expect(out.map((o) => o.price.toString())).toEqual(['525', '375']);
    const sum = out.reduce((acc, o) => acc.plus(o.price), d(0));
    expect(sum.toString()).toBe('900');
  });

  it('absorbs 2dp rounding residuals so the distributed sum is still exact', () => {
    const out = distributePackagePrice(d(100), [
      { testId: 'a', testName: 'A', standalonePrice: d(33) },
      { testId: 'b', testName: 'B', standalonePrice: d(33) },
      { testId: 'c', testName: 'C', standalonePrice: d(33) },
    ]);
    const sum = out.reduce((acc, o) => acc.plus(o.price), d(0));
    expect(sum.toString()).toBe('100');
    expect(out.map((o) => o.price.toString()).sort()).toEqual(['33.33', '33.33', '33.34']);
    expect(out.every((o) => o.price.isPositive())).toBe(true);
  });

  it('passes the whole package price through for a single-constituent package', () => {
    const out = distributePackagePrice(d(300), [{ testId: 't_a', testName: 'A', standalonePrice: d(400) }]);
    expect(out).toHaveLength(1);
    expect(out[0].price.toString()).toBe('300');
  });

  it('returns no line items for an empty package', () => {
    expect(distributePackagePrice(d(0), [])).toEqual([]);
  });

  it('falls back to an even split when every standalone price is zero', () => {
    const out = distributePackagePrice(d(90), [
      { testId: 'a', testName: 'A', standalonePrice: d(0) },
      { testId: 'b', testName: 'B', standalonePrice: d(0) },
      { testId: 'c', testName: 'C', standalonePrice: d(0) },
    ]);
    const sum = out.reduce((acc, o) => acc.plus(o.price), d(0));
    expect(sum.toString()).toBe('90');
    expect(out).toHaveLength(3);
  });
});
