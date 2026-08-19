import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { verificationCode } from '../common/report-code.util';
import { APPROVAL_ORDERTEST_SELECT } from '../approval/approval.service';
import { PrismaService } from '../prisma/prisma.service';
import { ageYears, toResultRow } from '../results/results.service';
import type { PortalUser } from './portal.types';

/**
 * Stage 8: Portal data service — the authenticated patient/referrer's view
 * of orders and reports. Each endpoint enforces strict ownership:
 *   - patient token → only orders where patientId matches the token
 *   - referrer token → only orders where referrerPartyId matches the token
 *   - report access requires the order to be fully approved (same 409 gate
 *     as Stage 6's report endpoint)
 *
 * This is the FIFTH consumer of the shared toResultRow mapper (Results →
 * Verify → Approval → Report → Portal), proving the extraction discipline
 * from Stage 4 continues to pay off.
 */
@Injectable()
export class PortalService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Patient portal
  // ---------------------------------------------------------------------------

  /**
   * GET /api/portal/patient/orders — all orders for the authenticated
   * patient, returned as a summary list (order number, date, status,
   * whether a report is ready).
   */
  async getPatientOrders(user: PortalUser & { type: 'patient' }) {
    const orders = await this.prisma.prisma.order.findMany({
      where: { patientId: user.patientId },
      include: {
        patient: { select: { patientUid: true, firstName: true, lastName: true } },
        orderTests: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => {
      const allApproved = order.orderTests.length > 0 && order.orderTests.every((t) => t.status === 'approved');
      return {
        orderId: order.id,
        orderNumber: order.id.slice(0, 8).toUpperCase(),
        createdAt: order.createdAt,
        status: order.status,
        isUrgent: order.isUrgent,
        reportReady: allApproved,
        patient: {
          patientUid: order.patient.patientUid,
          firstName: order.patient.firstName,
          lastName: order.patient.lastName,
        },
      };
    });
  }

  /**
   * GET /api/portal/patient/orders/:id/report — the full report for a
   * specific order, owned by the authenticated patient. Same 409 gate as
   * Stage 6 (every OrderTest must be approved). Ownership check: the order's
   * patientId must match the token's patientId — 403 otherwise.
   */
  async getPatientReport(user: PortalUser & { type: 'patient' }, orderId: string) {
    return this.getReport(orderId, (order) => {
      if (order.patientId !== user.patientId) {
        throw new ForbiddenException('You do not have access to this order');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Referrer portal
  // ---------------------------------------------------------------------------

  /**
   * GET /api/portal/referrer/orders — all orders referred by the
   * authenticated referrer, returned as a summary list.
   */
  async getReferrerOrders(user: PortalUser & { type: 'referrer' }) {
    const orders = await this.prisma.prisma.order.findMany({
      where: { referrerPartyId: user.partyId },
      include: {
        patient: { select: { patientUid: true, firstName: true, lastName: true, gender: true, dob: true, ageAtRegistration: true } },
        orderTests: { select: { status: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return orders.map((order) => {
      const allApproved = order.orderTests.length > 0 && order.orderTests.every((t) => t.status === 'approved');
      return {
        orderId: order.id,
        orderNumber: order.id.slice(0, 8).toUpperCase(),
        createdAt: order.createdAt,
        status: order.status,
        isUrgent: order.isUrgent,
        reportReady: allApproved,
        patient: {
          patientUid: order.patient.patientUid,
          firstName: order.patient.firstName,
          lastName: order.patient.lastName,
          gender: order.patient.gender,
          ageYears: ageYears(order.patient),
        },
      };
    });
  }

  /**
   * GET /api/portal/referrer/orders/:id/report — same report shape, owned
   * by the authenticated referrer via referrerPartyId.
   */
  async getReferrerReport(user: PortalUser & { type: 'referrer' }, orderId: string) {
    return this.getReport(orderId, (order) => {
      if (order.referrerPartyId !== user.partyId) {
        throw new ForbiddenException('You do not have access to this order');
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Shared report renderer (§2: reuse the same shared shape)
  // ---------------------------------------------------------------------------

  /**
   * The actual report-fetch logic, shared between patient and referrer.
   * Ownership is enforced by the caller-provided check before any data
   * is returned. This is the FOURTH place the report shape is rendered
   * (Stage 6 ReportsService → this portal service for patients → and
   * referrers), all sharing the same underlying data shape from
   * APPROVAL_ORDERTEST_SELECT + toResultRow.
   */
  private async getReport(
    orderId: string,
    ownershipCheck: (order: { patientId: string; referrerPartyId: string | null }) => void,
  ) {
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

    // Ownership check — fails before any data leak.
    ownershipCheck({ patientId: order.patientId, referrerPartyId: order.referrerPartyId });

    const rows = order.samples.flatMap((s) => s.orderTests);
    const notApproved = rows.filter((t) => t.status !== 'approved');
    if (notApproved.length > 0) {
      throw new ConflictException(
        'This report is not ready yet — some results are still awaiting approval.',
      );
    }

    let reportGeneratedAt = order.reportGeneratedAt;
    if (!reportGeneratedAt) {
      reportGeneratedAt = new Date();
      await this.prisma.prisma.order.update({
        where: { id: orderId },
        data: { reportGeneratedAt },
      });
    }

    const code = verificationCode(order.id);
    const approvedAt = rows.reduce<Date | null>((max, t) => {
      if (!t.approvedAt) return max;
      return max === null || t.approvedAt > max ? t.approvedAt : max;
    }, null);
    const signatureStamp = rows.find((t) => t.approvalSignatureStamp)?.approvalSignatureStamp ?? null;
    const approverRef = rows.find((t) => t.approvedBy)?.approvedBy ?? null;

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
      lab: { labName: order.organization.name, labAddress: null },
      signature: { signatureRef: approverRef, stamp: signatureStamp, approvedAt },
      verify: { code, path: `/verify-report?orderNumber=${encodeURIComponent(code)}` },
    };
  }
}
