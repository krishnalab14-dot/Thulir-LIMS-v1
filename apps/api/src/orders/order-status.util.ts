import { OrderStatus, OrderTestStatus } from '@prisma/client';

const RANK: Record<OrderTestStatus, number> = {
  pending: 0,
  entered: 1,
  verified: 2,
  approved: 3,
};

/**
 * Derives the Order.status rollup from its OrderTest.status values:
 *  - all tests approved                                        → approved
 *  - all at least verified, some not approved                  → partially_approved
 *  - all at least entered, some not verified                   → partially_verified
 *  - some entered but not all                                  → entered
 *  - everything still pending                                  → billed
 *
 * `collected` belongs to the sample-collection stage and is not reachable yet.
 */
export function computeOrderStatus(statuses: OrderTestStatus[]): OrderStatus {
  if (statuses.length === 0) {
    return 'billed';
  }
  if (statuses.every((s) => s === 'approved')) {
    return 'approved';
  }
  if (statuses.every((s) => RANK[s] >= RANK.verified) && statuses.some((s) => s !== 'approved')) {
    return 'partially_approved';
  }
  if (statuses.every((s) => RANK[s] >= RANK.entered) && statuses.some((s) => RANK[s] < RANK.verified)) {
    return 'partially_verified';
  }
  if (statuses.some((s) => RANK[s] >= RANK.entered)) {
    return 'entered';
  }
  return 'billed';
}
