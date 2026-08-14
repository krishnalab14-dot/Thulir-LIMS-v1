import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { OrderTestStatus, Prisma } from '@prisma/client';
import { SYSTEM_USER_ID } from '../common/constants';
import { computeOrderStatus } from '../orders/order-status.util';
import { PrismaService } from '../prisma/prisma.service';
import { RESULTS_ORDERTEST_SELECT, ageYears, toResultRow } from '../results/results.service';
import { ApproveOrderDto, RejectBackToVerifyDto } from './dto/approval-order.dto';

/**
 * The Stage 4 review select extended ONLY with the approval metadata — the
 * approve-review payload is the exact same shape as the entry grid / review
 * sheet plus each row's approval state, never a parallel one (this is now the
 * THIRD screen consuming the shared `toResultRow` mapper).
 */
const APPROVAL_ORDERTEST_SELECT = {
  ...RESULTS_ORDERTEST_SELECT,
  verifiedBy: true,
  verifiedAt: true,
  verifyRejectedNote: true,
  approvedBy: true,
  approvedAt: true,
  approvalSignatureStamp: true,
} satisfies Prisma.OrderTestSelect;

/**
 * Deterministic recorded-event reference for one approval: sha256 of
 * orderTestId + actor + timestamp + the signature reference, truncated to a
 * readable stamp. Enough to prove "this specific approval event happened" for
 * later Report rendering and audit purposes — NOT a legal e-signature.
 */
function signatureStamp(orderTestId: string, approvedBy: string, approvedAt: Date): string {
  return createHash('sha256')
    .update(`${orderTestId}|${approvedBy}|${approvedAt.toISOString()}|THULIR-v2-signature-ref`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
}

/**
 * Deterministic public-verification code placeholder for the report preview
 * (the real public-verification endpoint is a later stage's concern; a
 * deterministic value derived from the order id is enough for the preview to
 * render something real-looking). Format: THU-VR-<order id prefix>-<checksum>.
 */
function verificationCode(orderId: string): string {
  const prefix = orderId.slice(0, 8).toUpperCase();
  const check = createHash('sha1').update(orderId).digest('hex').slice(0, 4).toUpperCase();
  return `THU-VR-${prefix}-${check}`;
}

@Injectable()
export class ApprovalService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/approval-queue — orders with at least one `verified` OrderTest
   * awaiting approval, oldest-verified-first (ordered by the EARLIEST
   * verifiedAt among their pending tests — that is also the wait-time anchor:
   * how long this order has been waiting for approval). Same shape as Stage 4's
   * verify-queue.
   */
  async getApprovalQueue() {
    const orders = await this.prisma.prisma.order.findMany({
      where: { orderTests: { some: { status: 'verified' } } },
      include: {
        patient: { select: { id: true, patientUid: true, firstName: true, lastName: true, gender: true, dob: true, ageAtRegistration: true } },
        orderTests: {
          where: { status: 'verified' },
          select: { id: true, verifiedAt: true },
          orderBy: { verifiedAt: 'asc' },
        },
      },
    });

    return orders
      .map((order) => {
        const verifiedAt = order.orderTests[0]?.verifiedAt ?? null;
        return {
          orderId: order.id,
          orderStatus: order.status,
          isUrgent: order.isUrgent,
          createdAt: order.createdAt,
          verifiedCount: order.orderTests.length,
          verifiedAt,
          waitMs: verifiedAt ? Math.max(0, Date.now() - verifiedAt.getTime()) : 0,
          patient: {
            patientUid: order.patient.patientUid,
            firstName: order.patient.firstName,
            lastName: order.patient.lastName,
            gender: order.patient.gender,
            ageYears: ageYears(order.patient),
          },
        };
      })
      .sort((a, b) => (a.verifiedAt?.getTime() ?? 0) - (b.verifiedAt?.getTime() ?? 0));
  }

  /**
   * GET /api/orders/:id/approve-review — the FULL result sheet for one order:
   * every OrderTest regardless of status (the pathologist reviews the complete
   * picture before committing), same snapshot/flagging shape as the entry grid
   * and the Stage 4 review sheet plus each row's approval metadata — AND the
   * live-preview payload: lab letterhead details (org name; Settings'
   * printable-details page is a later stage, so address fields don't exist
   * yet — flagged as a small gap), the approving staff's signature reference
   * (StaffDetail is a later stage; the actor placeholder stands in), and a
   * deterministic QR/verification-code placeholder.
   */
  async getApproveReview(orderId: string) {
    const order = await this.prisma.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        patient: true,
        organization: { select: { id: true, name: true } },
        samples: {
          orderBy: { createdAt: 'asc' },
          include: {
            sampleType: { select: { id: true, name: true, code: true } },
            orderTests: { orderBy: { testNameSnapshot: 'asc' }, select: APPROVAL_ORDERTEST_SELECT },
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
        approvedBy: t.approvedBy,
        approvedAt: t.approvedAt,
        approvalSignatureStamp: t.approvalSignatureStamp,
      })),
    }));

    const total = samples.reduce((acc, s) => acc + s.orderTests.length, 0);
    const verified = samples.reduce((acc, s) => acc + s.orderTests.filter((t) => t.status === 'verified').length, 0);
    const approved = samples.reduce((acc, s) => acc + s.orderTests.filter((t) => t.status === 'approved').length, 0);

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
      summary: { total, verified, approved },
      preview: {
        labName: order.organization.name,
        // Printable org address fields don't exist yet (Settings is a later
        // stage) — the letterhead renders the name only, per §2.
        labAddress: null,
        signatureRef: SYSTEM_USER_ID, // StaffDetail is a later stage; actor placeholder until auth lands
        verificationCode: verificationCode(order.id),
      },
    };
  }

  /**
   * PUT /api/orders/:id/approve — batch approve of OrderTest ids. Per row:
   *   - concurrency-safe conditional update (`WHERE id AND orderId AND
   *     status = 'verified'`); zero rows affected → reported as SKIPPED,
   *     never a silent no-op and never a crash — the rest of the batch
   *     continues (same non-silent pattern as every prior stage's writes).
   *   - sets status = approved, approvedBy/approvedAt and a deterministic
   *     approvalSignatureStamp; clears a stale verifyRejectedNote so a prior
   *     reject-back cycle doesn't leak into the final report.
   * Then recomputes the Order.status rollup via the Stage 1 helper (extend,
   * don't duplicate) and persists it only when it changes.
   */
  async approve(orderId: string, dto: ApproveOrderDto) {
    const order = await this.prisma.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, orderTests: { select: { id: true, testNameSnapshot: true } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    if (dto.orderTestIds.length === 0) {
      return { approved: [], skipped: [], orderStatus: order.status };
    }

    const namesById = new Map(order.orderTests.map((ot) => [ot.id, ot.testNameSnapshot]));
    const now = new Date();

    return this.prisma.prisma.$transaction(async (tx) => {
      const approved: Array<{ orderTestId: string; testNameSnapshot: string; status: OrderTestStatus; approvedAt: Date; approvalSignatureStamp: string }> = [];
      const skipped: Array<{ orderTestId: string; reason: string; message: string }> = [];

      for (const orderTestId of dto.orderTestIds) {
        const res = await tx.orderTest.updateMany({
          where: { id: orderTestId, orderId, status: 'verified' },
          data: {
            status: 'approved',
            approvedBy: SYSTEM_USER_ID,
            approvedAt: now,
            approvalSignatureStamp: signatureStamp(orderTestId, SYSTEM_USER_ID, now),
            verifyRejectedNote: null,
          },
        });
        if (res.count === 0) {
          const name = namesById.get(orderTestId);
          skipped.push({
            orderTestId,
            reason: 'stale',
            message: name
              ? `'${name}' was not approved — it is not in 'verified' status (already approved, or not verified yet).`
              : `Order test ${orderTestId} was not approved — it is not in 'verified' status (already approved, or not verified yet).`,
          });
          continue;
        }
        approved.push({
          orderTestId,
          testNameSnapshot: namesById.get(orderTestId) ?? '',
          status: OrderTestStatus.approved,
          approvedAt: now,
          approvalSignatureStamp: signatureStamp(orderTestId, SYSTEM_USER_ID, now),
        });
      }

      let orderStatus = order.status;
      if (approved.length > 0) {
        const statuses = await tx.orderTest.findMany({ where: { orderId }, select: { status: true } });
        orderStatus = computeOrderStatus(statuses.map((s) => s.status));
        if (orderStatus !== order.status) {
          await tx.order.update({ where: { id: orderId }, data: { status: orderStatus } });
        }
      }

      return { approved, skipped, orderStatus };
    });
  }

  /**
   * PUT /api/orders/:id/reject-back-to-verify — ONE verified-or-approved row
   * at a time, with a required free-text reason (pathologist-initiated):
   *   - conditional update (`WHERE id AND orderId AND status IN
   *     ('verified','approved')`); zero rows → 409, never a silent no-op.
   *   - target state is the SAME `entered` state Verify's reject-back already
   *     uses — no fifth quasi-state. Reuses verifyRejectedNote for the reason
   *     and clears verifiedBy/At AND approvedBy/At/approvalSignatureStamp if
   *     set — the test must go through the full verify → approve cycle again
   *     after correction, not skip a step.
   *   - resultValue is NEVER touched — the technician corrects the existing
   *     value through the normal Result Entry save path.
   * Rollup recomputed via the same helper and written only when it changes.
   */
  async rejectBackToVerify(orderId: string, dto: RejectBackToVerifyDto) {
    const order = await this.prisma.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, orderTests: { select: { id: true, testNameSnapshot: true } } },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }

    return this.prisma.prisma.$transaction(async (tx) => {
      const res = await tx.orderTest.updateMany({
        where: { id: dto.orderTestId, orderId, status: { in: ['verified', 'approved'] } },
        data: {
          status: 'entered',
          verifyRejectedNote: dto.reason,
          verifiedBy: null,
          verifiedAt: null,
          approvedBy: null,
          approvedAt: null,
          approvalSignatureStamp: null,
        },
      });
      if (res.count === 0) {
        const name = order.orderTests.find((ot) => ot.id === dto.orderTestId)?.testNameSnapshot;
        throw new ConflictException(
          name
            ? `'${name}' is not verified or approved — it cannot be sent back to verify.`
            : `Order test ${dto.orderTestId} is not verified or approved — it cannot be sent back to verify.`,
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
