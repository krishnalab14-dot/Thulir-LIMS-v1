import { computeOrderStatus } from '../src/orders/order-status.util';

describe('computeOrderStatus (derived rollup)', () => {
  it('returns billed when every test is still pending', () => {
    expect(computeOrderStatus(['pending', 'pending'])).toBe('billed');
  });

  it('returns entered when some tests are entered but not all', () => {
    expect(computeOrderStatus(['entered', 'pending'])).toBe('entered');
  });

  it('returns partially_verified when all are entered but some are not verified', () => {
    expect(computeOrderStatus(['verified', 'entered'])).toBe('partially_verified');
  });

  it('returns partially_approved when all are at least verified but some are not approved', () => {
    expect(computeOrderStatus(['verified', 'approved'])).toBe('partially_approved');
  });

  it('returns approved when every test is approved', () => {
    expect(computeOrderStatus(['approved', 'approved'])).toBe('approved');
  });

  it('treats an order with no tests as billed', () => {
    expect(computeOrderStatus([])).toBe('billed');
  });
});
