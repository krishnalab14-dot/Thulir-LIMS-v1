import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderTestStatus, Prisma } from '@prisma/client';
import { computeOrderStatus } from '../orders/order-status.util';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { RESULTS_ORDERTEST_SELECT, ageYears, toResultRow } from '../results/results.service';
import { RejectBackDto, VerifyOrderDto } from './dto/verify-order.dto';

/**
 * The Stage 3 entry-grid select extended ONLY with the verification metadata
 * — the review payload is the exact same shape as GET /results plus each
 * row's verify state, never a parallel one.
 */
const REVIEW_ORDERTEST_SELECT = {
  ...RESULTS_ORDERTEST_SELECT,
  verifiedBy: true,
  verifiedAt: true,
  verifyRejectedNote: true,
} satisfies Prisma.OrderTestSelect;

@Injectable()
export class VerifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * GET /api/verify-queue — orders with at least one `entered` OrderTest
   * awaiting verification, oldest-entered-first (ordered by the EARLIEST
   * enteredAt among their pending tests — that is also the wait-time anchor:
   * how long this order has been waiting for verification).
   */
  async getVerifyQueue() {
    const orders = await this.prisma.prisma.order.findMany({
      where: { orderTests: { some: { status: 'entered' } } },
      include: {
        patient: { select: { id: true, patientUid: true, firstName: true, lastName: true, gender: true, dob: true, ageAtRegistration: true } },
        orderTests: {
          where: { status: 'entered' },
          select: { id: true, enteredAt: true },
          orderBy: { enteredAt: 'asc' },
        },
      },
    });

    return orders
      .map((order) => {
        const enteredAt = order.orderTests[0]?.enteredAt ?? null;
        return {
          orderId: order.id,
          orderStatus: order.status,
          isUrgent: order.isUrgent,
          createdAt: order.createdAt,
          enteredCount: order.orderTests.length,
          enteredAt,
          waitMs: enteredAt ? Math.max(0, Date.now() - enteredAt.getTime()) : 0,
          patient: {
            patientUid: order.patient.patientUid,
            firstName: order.patient.firstName,
            lastName: order.patient.lastName,
            gender: order.patient.gender,
            ageYears: ageYears(order.patient),
          },
        };
      })
      .sort((a, b) => (a.enteredAt?.getTime() ?? 0) - (b.enteredAt?.getTime() ?? 0));
  }

  /**
   * GET /api/orders/:id/review — the FULL result sheet for one order: every
   * OrderTest regardless of status (so the technician has full context), same
   * snapshot/flagging shape as the Stage 3 entry grid plus each row's current
   * status and verification metadata.
   */
  async getReview(orderId: string) {
    const order = await this.prisma.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        patient: true,
        samples: {
          orderBy: { createdAt: 'asc' },
          include: {
            sampleType: { select: { id: true, name: true, code: true } },
            orderTests: { orderBy: { testNameSnapshot: 'asc' }, select: REVIEW_ORDERTEST_SELECT },
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
      status: sample.status,
      sampleType: sample.sampleType,
      orderTests: sample.orderTests.map((t) => ({
        ...toResultRow(t),
        verifiedBy: t.verifiedBy,
        verifiedAt: t.verifiedAt,
        verifyRejectedNote: t.verifyRejectedNote,
      })),
    }));

    const total = samples.reduce((acc, s) => acc + s.orderTests.length, 0);
    const entered = samples.reduce((acc, s) => acc + s.orderTests.filter((t) => t.status === 'entered').length, 0);
    const verified = samples.reduce((acc, s) => acc + s.orderTests.filter((t) => t.status === 'verified').length, 0);

    return {
      order: { id: order.id, status: order.status, isUrgent: order.isUrgent, createdAt: order.createdAt },
      patient: {
        patientUid: order.patient.patientUid,
        firstName: order.patient.firstName,
        lastName: order.patient.lastName,
        gender: order.patient.gender,
        ageYears: ageYears(order.patient),
      },
      samples,
      summary: { total, entered, verified },
    };
  }

  /**
   * PUT /api/orders/:id/verify — batch verify of OrderTest ids. Per row:
   *   - concurrency-safe conditional update (`WHERE id AND orderId AND
   *     status = 'entered'`); zero rows affected → reported as SKIPPED, never
   *     a silent no-op and never a crash — the rest of the batch continues.
   *   - sets status = verified, verifiedBy/verifiedAt (the authenticated
   *     user, Stage 7), and clears verifyRejectedNote from a prior reject-back.
   * Then recomputes the Order.status rollup via the Stage 1 helper (extend,
   * don't duplicate) and persists it only when it changes.
   */
  async verify(orderId: string, dto: VerifyOrderDto) {
    const order = await this.prisma.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, orderTests: { select: { id: true, testNameSnapshot: true } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (dto.orderTestIds.length === 0) {
      return { verified: [], skipped: [], orderStatus: order.status };
    }

    const namesById = new Map(order.orderTests.map((ot) => [ot.id, ot.testNameSnapshot]));
    const now = new Date();

    return this.prisma.prisma.$transaction(async (tx) => {
      const verified: Array<{ orderTestId: string; testNameSnapshot: string; status: OrderTestStatus; verifiedAt: Date }> = [];
      const skipped: Array<{ orderTestId: string; reason: string; message: string }> = [];

      for (const orderTestId of dto.orderTestIds) {
        const res = await tx.orderTest.updateMany({
          where: { id: orderTestId, orderId, status: 'entered' },
          data: { status: 'verified', verifiedBy: this.tenant.requireUserId(), verifiedAt: now, verifyRejectedNote: null },
        });
        if (res.count === 0) {
          const name = namesById.get(orderTestId);
          skipped.push({
            orderTestId,
            reason: 'stale',
            message: name
              ? `'${name}' was not verified — it is not in 'entered' status (already verified/approved, or unknown).`
              : `Order test ${orderTestId} was not verified — it is not in 'entered' status (already verified/approved, or unknown).`,
          });
          continue;
        }
        verified.push({
          orderTestId,
          testNameSnapshot: namesById.get(orderTestId) ?? '',
          status: OrderTestStatus.verified,
          verifiedAt: now,
        });
      }

      let orderStatus = order.status;
      if (verified.length > 0) {
        const statuses = await tx.orderTest.findMany({ where: { orderId }, select: { status: true } });
        orderStatus = computeOrderStatus(statuses.map((s) => s.status));
        if (orderStatus !== order.status) {
          await tx.order.update({ where: { id: orderId }, data: { status: orderStatus } });
        }
      }

      return { verified, skipped, orderStatus };
    });
  }

  /**
   * PUT /api/orders/:id/reject-back-to-entry — ONE verified row at a time,
   * with a required free-text reason (the "Typing error in Sugar value"
   * reference UX):
   *   - conditional update (`WHERE id AND orderId AND status = 'verified'`);
   *     zero rows → 409, never a silent no-op.
   *   - status → entered, verifyRejectedNote = reason, verifiedBy/At cleared.
   *   - resultValue is NEVER touched — the technician sees the existing
   *     (wrong) value in Result Entry and corrects it through the normal
   *     save path.
   * Rollup recomputed via the same helper and written only when it changes.
   */
  async rejectBack(orderId: string, dto: RejectBackDto) {
    const order = await this.prisma.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, orderTests: { select: { id: true, testNameSnapshot: true } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.prisma.prisma.$transaction(async (tx) => {
      const res = await tx.orderTest.updateMany({
        where: { id: dto.orderTestId, orderId, status: 'verified' },
        data: { status: 'entered', verifiedBy: null, verifiedAt: null, verifyRejectedNote: dto.reason },
      });
      if (res.count === 0) {
        const name = order.orderTests.find((ot) => ot.id === dto.orderTestId)?.testNameSnapshot;
        throw new ConflictException(
          name
            ? `'${name}' is not in 'verified' status — it cannot be sent back to entry.`
            : `Order test ${dto.orderTestId} is not in 'verified' status — it cannot be sent back to entry.`,
        );
      }

      const statuses = await tx.orderTest.findMany({ where: { orderId }, select: { status: true } });
      const orderStatus = computeOrderStatus(statuses.map((s) => s.status));
      if (orderStatus !== order.status) {
        await tx.order.update({ where: { id: orderId }, data: { status: orderStatus } });
      }

      return { orderTestId: dto.orderTestId, status: 'entered', verifyRejectedNote: dto.reason, orderStatus };
    });
  }
}
