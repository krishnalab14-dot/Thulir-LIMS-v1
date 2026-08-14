import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderTestStatus, Prisma } from '@prisma/client';
import { SYSTEM_USER_ID } from '../common/constants';
import { computeOrderStatus } from '../orders/order-status.util';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { SaveResultsDto } from './dto/save-results.dto';
import { validateResultValue } from './result-value.util';

/**
 * The snapshot/result fields Result Entry (and Stage 4's Review workspace)
 * display for one OrderTest — reused verbatim by VerifyService so the review
 * payload is the exact same shape as the entry grid (never a parallel one).
 * VerifyService extends it with the verification metadata fields.
 */
export const RESULTS_ORDERTEST_SELECT = {
  id: true,
  testNameSnapshot: true,
  status: true,
  snapshottedResultType: true,
  snapshottedResultOptions: true,
  snapshottedResultOptionsAbnormal: true,
  snapshottedRefLow: true,
  snapshottedRefHigh: true,
  snapshottedCriticalLow: true,
  snapshottedCriticalHigh: true,
  snapshottedUnit: true,
  resultValue: true,
  enteredBy: true,
  enteredAt: true,
} satisfies Prisma.OrderTestSelect;

export type ResultRowSource = Prisma.OrderTestGetPayload<{ select: typeof RESULTS_ORDERTEST_SELECT }>;

/**
 * Maps an OrderTest row selected via RESULTS_ORDERTEST_SELECT into the wire
 * shape shared by GET /orders/:id/results (Stage 3) and Stage 4's
 * GET /orders/:id/review — ONE mapper, never a parallel implementation.
 * VerifyService extends the result with the verification metadata fields.
 */
export function toResultRow(t: ResultRowSource) {
  return {
    id: t.id,
    testNameSnapshot: t.testNameSnapshot,
    status: t.status,
    resultType: t.snapshottedResultType ?? 'numeric',
    resultOptions: Array.isArray(t.snapshottedResultOptions) ? (t.snapshottedResultOptions as string[]) : [],
    abnormalOptions: t.snapshottedResultOptionsAbnormal,
    refLow: t.snapshottedRefLow,
    refHigh: t.snapshottedRefHigh,
    criticalLow: t.snapshottedCriticalLow,
    criticalHigh: t.snapshottedCriticalHigh,
    unit: t.snapshottedUnit,
    resultValue: t.resultValue,
    enteredBy: t.enteredBy,
    enteredAt: t.enteredAt,
  };
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * GET /api/orders/:id/results — everything the entry grid needs in one
   * call, grouped by SAMPLE (the physical tube a technician is holding):
   * order/patient header + per-sample sections with their tests' snapshotted
   * type/range/options/critical thresholds, current value and status.
   * ONLY tests whose Sample.status = 'collected' are returned — an
   * uncollected sample's tests are not enterable, and the save endpoint
   * rejects them at the API level too.
   */
  async getResults(orderId: string) {
    const order = await this.prisma.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        patient: true,
        samples: {
          where: { status: 'collected' },
          orderBy: { createdAt: 'asc' },
          include: {
            sampleType: { select: { id: true, name: true, code: true } },
            orderTests: {
              orderBy: { testNameSnapshot: 'asc' },
              select: RESULTS_ORDERTEST_SELECT,
            },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const samples = order.samples.map((sample) => ({
      id: sample.id,
      barcodeValue: sample.barcodeValue,
      sampleType: sample.sampleType,
      orderTests: sample.orderTests.map((t) => toResultRow(t)),
    }));

    const total = samples.reduce((acc, s) => acc + s.orderTests.length, 0);
    const entered = samples.reduce((acc, s) => acc + s.orderTests.filter((t) => t.status !== 'pending').length, 0);

    return {
      order: { id: order.id, status: order.status, isUrgent: order.isUrgent, createdAt: order.createdAt },
      patient: {
        patientUid: order.patient.patientUid,
        firstName: order.patient.firstName,
        lastName: order.patient.lastName,
        gender: order.patient.gender,
        // Age recomputed NOW from DOB (same source-of-truth chain as order
        // creation) — display-only here; ranges were snapshotted at order time.
        ageYears: ageYears(order.patient),
      },
      samples,
      summary: { total, entered },
    };
  }

  /**
   * PUT /api/orders/:id/results — batch save, every step §2:
   *
   * Validation phase (whole-batch 400 — operator errors, surfaced loudly):
   *   - the row exists, belongs to this order/tenant (tenant fail-closed);
   *   - its Sample.status is 'collected' (an uncollected sample's tests are
   *     never enterable);
   *   - resultValue is valid against the row's OWN snapshots (never a live
   *     MasterTest lookup): numeric parses as a number, options ∈
   *     snapshottedResultOptions, text any non-empty string.
   *
   * Write phase (per-row, inside ONE transaction — the stale-state path):
   *   - conditional update, compare-and-swap on resultValue + status guard
   *     `NOT IN (verified, approved)`: the write only lands if the row still
   *     holds the expectedValue the client observed (omitted ⇒ null, the
   *     entry path). Under two simultaneous saves of the same pending row,
   *     exactly one lands — the loser's CAS predicate is re-evaluated
   *     against the winner's committed row and fails (0 rows) → reported as
   *     skipped, never silently overwritten, never a crash. The status guard
   *     stops a stale Result Entry save from clobbering a row that a later
   *     stage has already verified/approved.
   *   - empty resultValue = "not yet entered": clears the row (resultValue,
   *     enteredBy, enteredAt → null, status → pending) — never advances.
   *   - after the batch, the Order.status rollup is recomputed from ALL of
   *     the order's OrderTest statuses via the existing Stage 1 helper (not
   *     a second implementation) and written only when it changes.
   */
  async saveResults(orderId: string, dto: SaveResultsDto) {
    const order = await this.prisma.prisma.order.findUnique({
      where: { id: orderId },
      include: { orderTests: { include: { sample: true } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (dto.entries.length === 0) {
      return { updated: [], skipped: [], orderStatus: order.status };
    }

    const rowsById = new Map(order.orderTests.map((ot) => [ot.id, ot]));

    for (const entry of dto.entries) {
      const ot = rowsById.get(entry.orderTestId);
      if (!ot) {
        throw new BadRequestException(`Unknown order test ${entry.orderTestId}`);
      }
      if (!ot.sample || ot.sample.status !== 'collected') {
        throw new BadRequestException(
          `Cannot enter a result for '${ot.testNameSnapshot}': its sample has not been collected yet`,
        );
      }
      const err = validateResultValue(ot, entry.resultValue);
      if (err) {
        throw new BadRequestException(`Invalid result for '${ot.testNameSnapshot}': ${err}`);
      }
    }

    return this.prisma.prisma.$transaction(async (tx) => {
      const updated: Array<{
        orderTestId: string;
        testNameSnapshot: string;
        resultValue: string | null;
        status: OrderTestStatus;
        enteredBy: string | null;
        enteredAt: Date | null;
      }> = [];
      const skipped: Array<{ orderTestId: string; reason: string; message: string }> = [];

      for (const entry of dto.entries) {
        const ot = rowsById.get(entry.orderTestId)!;
        const clearing = entry.resultValue === '';

        const res = await tx.orderTest.updateMany({
          where: {
            id: ot.id,
            orderId,
            status: { notIn: [OrderTestStatus.verified, OrderTestStatus.approved] },
            resultValue: entry.expectedValue ?? null, // compare-and-swap anchor
          },
          data: clearing
            ? { resultValue: null, enteredBy: null, enteredAt: null, status: OrderTestStatus.pending }
            : { resultValue: entry.resultValue, enteredBy: SYSTEM_USER_ID, enteredAt: new Date(), status: OrderTestStatus.entered },
        });

        if (res.count === 0) {
          skipped.push({
            orderTestId: ot.id,
            reason: 'stale',
            message: `'${ot.testNameSnapshot}' was not saved — it changed elsewhere or is already verified/approved.`,
          });
          continue;
        }

        updated.push({
          orderTestId: ot.id,
          testNameSnapshot: ot.testNameSnapshot,
          resultValue: clearing ? null : entry.resultValue,
          status: clearing ? OrderTestStatus.pending : OrderTestStatus.entered,
          enteredBy: clearing ? null : SYSTEM_USER_ID,
          enteredAt: clearing ? null : new Date(),
        });
      }

      // Auto-complete cascade: recompute the derived rollup from ALL
      // OrderTest statuses (extending the Stage 1 helper, never a second
      // implementation) and persist only when it actually changes.
      let orderStatus = order.status;
      if (updated.length > 0) {
        const statuses = await tx.orderTest.findMany({ where: { orderId }, select: { status: true } });
        orderStatus = computeOrderStatus(statuses.map((s) => s.status));
        if (orderStatus !== order.status) {
          await tx.order.update({ where: { id: orderId }, data: { status: orderStatus } });
        }
      }

      return { updated, skipped, orderStatus };
    });
  }
}

/** Patient age in whole years at this moment (DOB-first, ageAtRegistration fallback). */
export function ageYears(patient: { dob: Date | null; ageAtRegistration: number | null }): number {
  if (patient.dob) {
    const now = new Date();
    let years = now.getFullYear() - patient.dob.getFullYear();
    const m = now.getMonth() - patient.dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < patient.dob.getDate())) {
      years -= 1;
    }
    return Math.max(0, years);
  }
  return patient.ageAtRegistration ?? 0;
}
