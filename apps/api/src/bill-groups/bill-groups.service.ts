import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { deriveInvoiceStatus, normalizeAndValidateSplits, roundMoney, sumSplits } from '../billing/payment.util';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { CreateGroupPaymentDto } from './dto/create-group-payment.dto';

@Injectable()
export class BillGroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * POST /api/bill-groups — creates a new empty BillGroup in the current
   * tenant scope. The authenticated user is stamped as createdBy.
   */
  create() {
    const organizationId = this.tenant.requireOrganizationId();
    const userId = this.tenant.requireUserId();

    return this.prisma.prisma.billGroup.create({
      data: {
        organizationId,
        createdBy: userId,
      },
    });
  }

  /**
   * PATCH /api/bill-groups/:id/orders/:orderId — links an existing Order to
   * the given BillGroup by setting Order.billGroupId. Validates that both
   * the group and the order belong to the current tenant.
   */
  async linkOrder(groupId: string, orderId: string) {
    this.tenant.requireOrganizationId();

    const group = await this.prisma.prisma.billGroup.findFirst({
      where: { id: groupId },
    });
    if (!group) throw new NotFoundException('BillGroup not found');

    const order = await this.prisma.prisma.order.findFirst({
      where: { id: orderId },
    });
    if (!order) throw new NotFoundException('Order not found');

    await this.prisma.prisma.order.update({
      where: { id: orderId },
      data: { billGroupId: groupId },
    });

    return { groupId, orderId, linked: true };
  }

  /**
   * GET /api/bill-groups/:id — returns the BillGroup with its linked orders
   * (each including patient, tests, invoice with payment splits, and computed
   * paid/outstanding), plus combined group-level totals.
   */
  async findOne(groupId: string) {
    this.tenant.requireOrganizationId();

    const group = await this.prisma.prisma.billGroup.findFirst({
      where: { id: groupId },
      include: {
        orders: {
          include: {
            patient: true,
            orderTests: true,
            invoice: {
              include: {
                payments: {
                  include: { splits: true },
                },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundException('BillGroup not found');

    // Compute per-order paid/outstanding and combined totals
    let combinedSubtotal = new Prisma.Decimal(0);
    let combinedDiscount = new Prisma.Decimal(0);
    let combinedTotal = new Prisma.Decimal(0);
    let combinedPaid = new Prisma.Decimal(0);

    const ordersWithBalances = group.orders.map((order) => {
      const invoice = order.invoice;
      if (!invoice) return { ...order, paid: 0, outstanding: 0 };

      const paid = roundMoney(
        invoice.payments.reduce(
          (acc, p) => acc.plus(p.splits.reduce((a, s) => a.plus(s.amount), new Prisma.Decimal(0))),
          new Prisma.Decimal(0),
        ),
      );
      const outstanding = roundMoney(invoice.totalAmount.minus(paid));

      combinedSubtotal = combinedSubtotal.plus(invoice.subtotal);
      combinedDiscount = combinedDiscount.plus(invoice.discountPercent);
      combinedTotal = combinedTotal.plus(invoice.totalAmount);
      combinedPaid = combinedPaid.plus(paid);

      return {
        ...order,
        invoice: {
          ...invoice,
          paid: paid.toNumber(),
          outstanding: outstanding.toNumber(),
        },
      };
    });

    const combinedOutstanding = roundMoney(combinedTotal.minus(combinedPaid));

    return {
      ...group,
      orders: ordersWithBalances,
      combinedSubtotal: combinedSubtotal.toNumber(),
      combinedTotal: combinedTotal.toNumber(),
      combinedPaid: combinedPaid.toNumber(),
      combinedOutstanding: combinedOutstanding.toNumber(),
    };
  }

  /**
   * POST /api/bill-groups/:id/payments — distributes a single payment across
   * the group's linked orders' outstanding balances.
   *
   * Distribution strategy: pay orders with outstanding balances in ascending
   * order of their invoice total (oldest/smallest first). Each order receives
   * up to its outstanding balance from the available payment amount. If the
   * payment exceeds all outstanding balances, the excess is rejected.
   *
   * Each affected order gets its own Payment + PaymentSplit rows, and its
   * Invoice.status is re-derived from cumulative paid.
   */
  async addPayment(groupId: string, dto: CreateGroupPaymentDto) {
    this.tenant.requireOrganizationId();

    return this.prisma.prisma.$transaction(async (tx) => {
      const group = await tx.billGroup.findFirst({
        where: { id: groupId },
        include: {
          orders: {
            include: {
              invoice: true,
            },
            orderBy: { totalAmount: 'asc' },
          },
        },
      });
      if (!group) throw new NotFoundException('BillGroup not found');

      if (group.orders.length === 0) {
        throw new BadRequestException('BillGroup has no linked orders');
      }

      const splits = normalizeAndValidateSplits(dto.splits);
      const amountPaid = dto.amount != null
        ? roundMoney(new Prisma.Decimal(dto.amount))
        : sumSplits(splits);

      if (!sumSplits(splits).equals(amountPaid)) {
        throw new BadRequestException('Payment splits do not sum exactly to the amount being paid');
      }

      let remainingToDistribute = amountPaid;
      const distribution: Array<{
        orderId: string;
        invoiceId: string;
        distributed: Prisma.Decimal;
        newStatus: string;
      }> = [];

      // Sort orders: outstanding balance ASC (pay smallest first)
      const ordersWithBalance = group.orders
        .filter((o) => o.invoice)
        .map((o) => {
          // We need to compute outstanding for each order by reading its existing payments
          return o;
        })
        .sort((a, b) => {
          const aTotal = a.invoice!.totalAmount;
          const bTotal = b.invoice!.totalAmount;
          return aTotal.lessThan(bTotal) ? -1 : aTotal.greaterThan(bTotal) ? 1 : 0;
        });

      for (const order of ordersWithBalance) {
        if (remainingToDistribute.lessThanOrEqualTo(0)) break;

        const invoice = order.invoice!;

        // Compute existing paid for this invoice
        const existingPayments = await tx.payment.findMany({
          where: { invoiceId: invoice.id },
          include: { splits: true },
        });
        const existingPaid = roundMoney(
          existingPayments.reduce(
            (acc, p) => acc.plus(p.splits.reduce((a, s) => a.plus(s.amount), new Prisma.Decimal(0))),
            new Prisma.Decimal(0),
          ),
        );
        const outstanding = roundMoney(invoice.totalAmount.minus(existingPaid));

        if (outstanding.lessThanOrEqualTo(0)) continue;

        // Allocate the lesser of remaining payment and this order's outstanding
        const allocated = roundMoney(
          Prisma.Decimal.min(remainingToDistribute, outstanding),
        );

        if (allocated.lessThanOrEqualTo(0)) continue;

        // Create a Payment + PaymentSplit for this order, proportional to the allocation
        // The splits describe HOW the group payment is made. For a single order within
        // the group, we record the same modes but proportionally scaled to the allocation.
        const splitTotal = sumSplits(splits);
        const scaledSplits = splits.map((split) => ({
          mode: split.mode,
          amount: roundMoney(
            split.amount.times(allocated).dividedBy(splitTotal),
          ),
        }));

        // Fix any rounding drift: adjust the largest split to make sum exact
        const scaledSum = sumSplits(scaledSplits);
        const drift = roundMoney(allocated.minus(scaledSum));
        if (!drift.equals(new Prisma.Decimal(0))) {
          // Find the largest split and adjust
          const maxIdx = scaledSplits.reduce(
            (maxI, s, i, arr) => (s.amount.greaterThan(arr[maxI].amount) ? i : maxI),
            0,
          );
          scaledSplits[maxIdx].amount = roundMoney(scaledSplits[maxIdx].amount.plus(drift));
        }

        await tx.payment.create({
          data: {
            organizationId: group.organizationId,
            invoiceId: invoice.id,
            collectedBy: this.tenant.requireUserId(),
            splits: { create: scaledSplits },
          },
        });

        // Re-derive invoice status
        const allPayments = await tx.payment.findMany({
          where: { invoiceId: invoice.id },
          include: { splits: true },
        });
        const cumulativePaid = roundMoney(
          allPayments.reduce(
            (acc, p) => acc.plus(p.splits.reduce((a, s) => a.plus(s.amount), new Prisma.Decimal(0))),
            new Prisma.Decimal(0),
          ),
        );
        const newStatus = deriveInvoiceStatus(cumulativePaid, invoice.totalAmount);
        if (newStatus !== invoice.status) {
          await tx.invoice.update({
            where: { id: invoice.id },
            data: { status: newStatus },
          });
        }

        distribution.push({
          orderId: order.id,
          invoiceId: invoice.id,
          distributed: allocated,
          newStatus,
        });

        remainingToDistribute = roundMoney(remainingToDistribute.minus(allocated));
      }

      if (remainingToDistribute.greaterThan(0)) {
        throw new BadRequestException(
          `Payment amount exceeds total outstanding balance of the group. Unallocated: ₹${remainingToDistribute.toFixed(2)}`,
        );
      }

      return {
        groupId,
        totalPaid: amountPaid.toNumber(),
        distribution: distribution.map((d) => ({
          orderId: d.orderId,
          invoiceId: d.invoiceId,
          distributed: d.distributed.toNumber(),
          newStatus: d.newStatus,
        })),
      };
    });
  }

  /**
   * PATCH /api/bill-groups/:id/orders/:orderId/unlink — removes an Order from
   * its BillGroup (sets billGroupId = null).
   */
  async unlinkOrder(groupId: string, orderId: string) {
    this.tenant.requireOrganizationId();

    const order = await this.prisma.prisma.order.findFirst({
      where: { id: orderId, billGroupId: groupId },
    });
    if (!order) throw new NotFoundException('Order not linked to this BillGroup');

    await this.prisma.prisma.order.update({
      where: { id: orderId },
      data: { billGroupId: null },
    });

    return { groupId, orderId, unlinked: true };
  }
}
