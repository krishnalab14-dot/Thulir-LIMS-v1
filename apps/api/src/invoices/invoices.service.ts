import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { deriveInvoiceStatus, normalizeAndValidateSplits, roundMoney, sumSplits } from '../billing/payment.util';
import { SYSTEM_USER_ID } from '../common/constants';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * POST /api/invoices/:invoiceId/payments — records an additional payment
   * event against a due/partial invoice. Same exact split-sum validation as
   * order-time payments; Invoice.status is re-derived from cumulative paid.
   */
  async addPayment(invoiceId: string, dto: CreatePaymentDto) {
    this.tenant.requireOrganizationId();

    return this.prisma.prisma.$transaction(async (tx) => {
      const invoice = await tx.invoice.findFirst({ where: { id: invoiceId } });
      if (!invoice) {
        throw new NotFoundException('Invoice not found');
      }

      const splits = normalizeAndValidateSplits(dto.splits);
      const amountPaid = dto.amount != null ? roundMoney(new Prisma.Decimal(dto.amount)) : sumSplits(splits);
      if (!sumSplits(splits).equals(amountPaid)) {
        throw new BadRequestException('Payment splits do not sum exactly to the amount being paid');
      }

      await tx.payment.create({
        data: {
          organizationId: invoice.organizationId,
          invoiceId: invoice.id,
          collectedBy: SYSTEM_USER_ID,
          splits: { create: splits.map((s) => ({ mode: s.mode, amount: s.amount })) },
        },
      });

      const payments = await tx.payment.findMany({ where: { invoiceId: invoice.id }, include: { splits: true } });
      const cumulative = roundMoney(
        payments.reduce(
          (acc, p) =>
            acc.plus(p.splits.reduce((a, s) => a.plus(s.amount), new Prisma.Decimal(0))),
          new Prisma.Decimal(0),
        ),
      );

      const status = deriveInvoiceStatus(cumulative, invoice.totalAmount);
      if (status !== invoice.status) {
        await tx.invoice.update({ where: { id: invoice.id }, data: { status } });
      }

      return { invoiceId: invoice.id, status, paid: cumulative, total: invoice.totalAmount };
    });
  }
}
