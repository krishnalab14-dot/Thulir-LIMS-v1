import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SYSTEM_USER_ID } from '../common/constants';
import { verificationCode } from '../common/report-code.util';
import { APPROVAL_ORDERTEST_SELECT } from '../approval/approval.service';
import { PrismaService } from '../prisma/prisma.service';
import { ageYears, toResultRow } from '../results/results.service';

/**
 * The report reuses the approval sheet shape (results + verify + approval
 * metadata) verbatim — the FOURTH screen consuming the shared `toResultRow`
 * mapper. The report renders exactly what the pathologist approved, nothing
 * else.
 */

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /api/orders/:id/report — the final report for a FULLY APPROVED order.
   *   - 409 unless EVERY OrderTest in the order is approved (server-side gate,
   *     never frontend-enforced) — same non-silent pattern as every stage.
   *   - Sets order.reportGeneratedAt on the FIRST successful generation (once
   *     only; subsequent views keep the original issue date).
   *   - Returns everything the print page needs: patient, order, every result
   *     with its snapshotted range/unit/flags, lab letterhead details (org
   *     name only — Settings' printable-details page is still a later stage,
   *     same gap-flagging discipline as Stage 5), signature block info, and
   *     the real verification code for the public QR endpoint.
   */
  async getReport(orderId: string) {
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

    const rows = order.samples.flatMap((s) => s.orderTests);
    const notApproved = rows.filter((t) => t.status !== 'approved');
    if (notApproved.length > 0) {
      const names = notApproved.slice(0, 3).map((t) => `'${t.testNameSnapshot}'`).join(', ');
      const more = notApproved.length > 3 ? ` (and ${notApproved.length - 3} more)` : '';
      throw new ConflictException(
        `Report is not ready — ${notApproved.length} result${notApproved.length === 1 ? ' is' : 's are'} still awaiting approval: ${names}${more}.`,
      );
    }

    // Stamp the issue date once — the report is dated by its first generation,
    // not by each view.
    let reportGeneratedAt = order.reportGeneratedAt;
    if (!reportGeneratedAt) {
      reportGeneratedAt = new Date();
      await this.prisma.prisma.order.update({
        where: { id: orderId },
        data: { reportGeneratedAt },
      });
    }

    const approvedAt = rows.reduce<Date | null>((max, t) => {
      if (!t.approvedAt) return max;
      return max === null || t.approvedAt > max ? t.approvedAt : max;
    }, null);
    const signatureStamp = rows.find((t) => t.approvalSignatureStamp)?.approvalSignatureStamp ?? null;
    const code = verificationCode(order.id);

    return {
      order: {
        id: order.id,
        status: order.status,
        isUrgent: order.isUrgent,
        createdAt: order.createdAt,
        reportGeneratedAt,
        verificationCode: code,
      },
      patient: {
        patientUid: order.patient.patientUid,
        firstName: order.patient.firstName,
        lastName: order.patient.lastName,
        gender: order.patient.gender,
        ageYears: ageYears(order.patient),
        dob: order.patient.dob,
      },
      samples: order.samples.map((sample) => ({
        id: sample.id,
        barcodeValue: sample.barcodeValue,
        sampleType: sample.sampleType,
        orderTests: sample.orderTests.map((t) => ({
          ...toResultRow(t),
          verifiedBy: t.verifiedBy,
          verifiedAt: t.verifiedAt,
          approvedBy: t.approvedBy,
          approvedAt: t.approvedAt,
          approvalSignatureStamp: t.approvalSignatureStamp,
        })),
      })),
      summary: { total: rows.length },
      lab: {
        labName: order.organization.name,
        // Settings' printable-details page doesn't exist yet (later stage) —
        // the letterhead renders the name only; address fields are a flagged gap.
        labAddress: null,
      },
      signature: {
        // StaffDetail is a later stage; the actor placeholder stands in until
        // auth lands, same as every stage since Stage 1.
        signatureRef: SYSTEM_USER_ID,
        stamp: signatureStamp,
        approvedAt,
      },
      verify: {
        code,
        // The public check page path the QR encodes; the frontend builds the
        // absolute URL with its own origin.
        path: `/verify-report?orderNumber=${encodeURIComponent(code)}`,
      },
    };
  }
}
