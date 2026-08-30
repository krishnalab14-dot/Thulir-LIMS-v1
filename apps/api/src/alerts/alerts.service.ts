import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { InventoryService } from '../inventory/inventory.service';

/** Fields needed to render an alert in the inbox (patient/order context). */
const ALERT_INCLUDE = {
  orderTest: {
    select: {
      id: true,
      testNameSnapshot: true,
      orderId: true,
      order: {
        select: {
          id: true,
          billNo: true,
          patient: {
            select: {
              patientUid: true,
              firstName: true,
              lastName: true,
              gender: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CriticalAlertInclude;

export type AlertRow = Prisma.CriticalAlertGetPayload<{ include: typeof ALERT_INCLUDE }>;

@Injectable()
export class AlertsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly inventoryService: InventoryService,
  ) {}

  /**
   * GET /api/alerts — list alerts, filterable by acknowledged/unacknowledged,
   * most-recent-first. Includes patient/order context for display.
   */
  async listAlerts(filter?: 'acknowledged' | 'unacknowledged') {
    const where: Prisma.CriticalAlertWhereInput = {};

    if (filter === 'acknowledged') {
      where.acknowledgedAt = { not: null };
    } else if (filter === 'unacknowledged') {
      where.acknowledgedAt = null;
    }

    const alerts = await this.prisma.prisma.criticalAlert.findMany({
      where,
      include: ALERT_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });

    return alerts.map((a) => ({
      id: a.id,
      value: a.value,
      acknowledgedBy: a.acknowledgedBy,
      acknowledgedAt: a.acknowledgedAt,
      createdAt: a.createdAt,
      orderTestId: a.orderTestId,
      testName: a.orderTest.testNameSnapshot,
      orderId: a.orderTest.orderId,
      billNo: a.orderTest.order.billNo,
      patient: a.orderTest.order.patient,
    }));
  }

  /**
   * PUT /api/alerts/:id/acknowledge — conditional update, concurrency-safe.
   * Zero rows affected → already acknowledged → ConflictException.
   */
  async acknowledge(alertId: string) {
    const userId = this.tenant.requireUserId();

    const res = await this.prisma.prisma.criticalAlert.updateMany({
      where: {
        id: alertId,
        acknowledgedAt: null, // only unacknowledged alerts
      },
      data: {
        acknowledgedBy: userId,
        acknowledgedAt: new Date(),
      },
    });

    if (res.count === 0) {
      // Check if the alert exists at all (might be a non-existent id)
      const exists = await this.prisma.prisma.criticalAlert.findUnique({
        where: { id: alertId },
        select: { id: true, acknowledgedAt: true },
      });
      if (!exists) {
        throw new NotFoundException('Alert not found');
      }
      // Already acknowledged
      throw new ConflictException('This alert has already been acknowledged');
    }

    return { success: true, alertId, acknowledgedBy: userId };
  }

  /**
   * Count unacknowledged alerts (for the NavBar badge).
   * Includes both critical-value alerts AND inventory alerts (low-stock + expiring).
   */
  async unacknowledgedCount(): Promise<number> {
    const criticalCount = await this.prisma.prisma.criticalAlert.count({
      where: { acknowledgedAt: null },
    });
    const inventoryCount = await this.inventoryService.alertCount();
    return criticalCount + inventoryCount;
  }
}
