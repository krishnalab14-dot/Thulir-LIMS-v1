import { Injectable } from '@nestjs/common';
import { VERIFICATION_CODE_RE, orderIdFromVerificationCode, verificationCode } from '../common/report-code.util';
import { PrismaService } from '../prisma/prisma.service';
import { VerifyReportQueryDto } from './dto/verify-report-query.dto';

/**
 * GET /api/public/verify-report — the authenticity check behind the QR code
 * on a printed report. This endpoint is PUBLIC by design (reachable from a
 * printed QR; no auth, no tenant header from the patient), so it carries a
 * deliberately minimal information budget:
 *
 *   - Success returns ONLY { valid, orderNumber, labName, reportDate } — no
 *     patient name, no results, no test list. Full results require the
 *     authenticated patient/referrer portal (a real future stage; deliberately
 *     NOT built as a shortcut here).
 *   - The THREE failure cases — unknown order number, order not fully
 *     approved, and wrong DOB — all return the identical { valid: false }
 *     body (HTTP 200). A wrong-DOB-but-valid-order response must be
 *     indistinguishable from a nonexistent order, or the endpoint itself
 *     becomes an oracle ("this order number exists").
 *
 * Tenant scoping: this is the ONE intentionally tenant-free lookup in the
 * app, and it goes through PrismaService.raw — the allowlisted escape hatch
 * documented there. That is safe because order ids are globally unique (the
 * verification code resolves deterministically to the id) and the response
 * exposes nothing tenant-identifying beyond the lab name. Every other service
 * keeps using the fail-closed tenant-scoped client.
 */
@Injectable()
export class PublicVerifyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves an order by its verification code (THU-VR-…, printed on the
   * report) or raw order id — both globally unique — over the raw client, or
   * null. Callers treat null exactly like every other failure case.
   */
  private async findOrder(input: string) {
    const code = input.trim();
    const select = {
      id: true,
      status: true,
      reportGeneratedAt: true,
      organization: { select: { name: true } },
      patient: { select: { dob: true } },
    } as const;

    const match = VERIFICATION_CODE_RE.exec(code);
    if (match) {
      // Verification code: the 8-char prefix narrows to candidate ids, the
      // recomputed checksum picks the exact one.
      const candidates = await this.prisma.raw.order.findMany({
        where: { id: { startsWith: match[1].toLowerCase() } },
        select,
      });
      const id = orderIdFromVerificationCode(code, candidates);
      return candidates.find((c) => c.id === id) ?? null;
    }

    // Raw order id (globally unique cuid) — resilient fallback.
    return this.prisma.raw.order.findUnique({ where: { id: code }, select });
  }

  async verifyReport(dto: VerifyReportQueryDto): Promise<{
    valid: boolean;
    orderNumber?: string;
    labName?: string;
    reportDate?: string;
  }> {
    const order = await this.findOrder(dto.orderNumber);
    if (!order) {
      return { valid: false };
    }

    // Not fully approved → the same not-found shape (no signal about whether
    // the order exists or merely isn't ready yet).
    const approvedAt: Array<{ approvedAt: Date | null }> = await this.prisma.raw.orderTest.findMany({
      where: { orderId: order.id },
      select: { approvedAt: true },
    });
    if (approvedAt.length === 0 || !approvedAt.every((t) => t.approvedAt)) {
      return { valid: false };
    }

    // DOB is the second factor. A patient registered by age (no dob) can
    // never pass this check — the correct fail-closed behavior.
    const dob = order.patient.dob;
    if (!dob) {
      return { valid: false };
    }
    if (dob.toISOString().slice(0, 10) !== dto.dob) {
      return { valid: false };
    }

    const latestApproval = approvedAt.reduce<Date | null>((max, t) => {
      if (!t.approvedAt) return max;
      return max === null || t.approvedAt > max ? t.approvedAt : max;
    }, null);

    return {
      valid: true,
      orderNumber: verificationCode(order.id),
      labName: order.organization.name,
      reportDate: (order.reportGeneratedAt ?? latestApproval ?? new Date()).toISOString().slice(0, 10),
    };
  }
}
