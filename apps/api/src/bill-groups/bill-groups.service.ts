import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';

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
   * (each including patient, tests, and invoice).
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
            invoice: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!group) throw new NotFoundException('BillGroup not found');

    return group;
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
