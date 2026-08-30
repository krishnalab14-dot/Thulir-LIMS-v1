import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InventoryDirection } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { nextItemCode } from './item-code.util';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';

@Injectable()
export class InventoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  // ---------------------------------------------------------------------------
  // Supplier CRUD
  // ---------------------------------------------------------------------------

  async listSuppliers() {
    return this.prisma.prisma.inventorySupplier.findMany({
      orderBy: { name: 'asc' },
    });
  }

  async getSupplier(id: string) {
    const supplier = await this.prisma.prisma.inventorySupplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return supplier;
  }

  async createSupplier(dto: CreateSupplierDto) {
    const orgId = this.tenant.requireOrganizationId();
    return this.prisma.prisma.inventorySupplier.create({
      data: {
        organizationId: orgId,
        name: dto.name.trim(),
        contactPhone: dto.contactPhone,
        contactEmail: dto.contactEmail,
        active: dto.active ?? true,
      },
    });
  }

  async updateSupplier(id: string, dto: UpdateSupplierDto) {
    const supplier = await this.prisma.prisma.inventorySupplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundException('Supplier not found');
    return this.prisma.prisma.inventorySupplier.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.contactPhone !== undefined ? { contactPhone: dto.contactPhone } : {}),
        ...(dto.contactEmail !== undefined ? { contactEmail: dto.contactEmail } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Item CRUD (code auto-generated on creation)
  // ---------------------------------------------------------------------------

  async listItems() {
    const items = await this.prisma.prisma.inventoryItem.findMany({
      orderBy: { name: 'asc' },
      include: { preferredSupplier: { select: { id: true, name: true } } },
    });

    // Compute current stock for each item via the ledger
    return Promise.all(
      items.map(async (item) => {
        const stock = await this.computeStock(item.id);
        return { ...item, currentStock: stock };
      }),
    );
  }

  async getItem(id: string) {
    const item = await this.prisma.prisma.inventoryItem.findUnique({
      where: { id },
      include: { preferredSupplier: { select: { id: true, name: true } } },
    });
    if (!item) throw new NotFoundException('Item not found');
    const stock = await this.computeStock(item.id);
    return { ...item, currentStock: stock };
  }

  async createItem(dto: CreateItemDto) {
    const orgId = this.tenant.requireOrganizationId();
    const org = await this.prisma.raw.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    return this.prisma.raw.$transaction(async (tx) => {
      const code = await nextItemCode(tx, org);
      return tx.inventoryItem.create({
        data: {
          organizationId: orgId,
          code,
          name: dto.name.trim(),
          unit: dto.unit.trim(),
          reorderThreshold: dto.reorderThreshold ?? null,
          preferredSupplierId: dto.preferredSupplierId ?? null,
          active: dto.active ?? true,
        },
      });
    });
  }

  async updateItem(id: string, dto: UpdateItemDto) {
    const item = await this.prisma.prisma.inventoryItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Item not found');
    return this.prisma.prisma.inventoryItem.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
        ...(dto.unit !== undefined ? { unit: dto.unit.trim() } : {}),
        ...(dto.reorderThreshold !== undefined ? { reorderThreshold: dto.reorderThreshold } : {}),
        ...(dto.preferredSupplierId !== undefined ? { preferredSupplierId: dto.preferredSupplierId || null } : {}),
        ...(dto.active !== undefined ? { active: dto.active } : {}),
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Stock computation (ledger sum — append-only, concurrency-safe by design)
  // ---------------------------------------------------------------------------

  /** Current stock for an item = SUM(in) - SUM(out). */
  async computeStock(itemId: string): Promise<number> {
    const orgId = this.tenant.requireOrganizationId();
    const result = await this.prisma.prisma.$queryRaw<Array<{ total: bigint | null }>>`
      SELECT COALESCE(SUM(
        CASE WHEN "direction" = 'in' THEN "quantity" ELSE -"quantity" END
      ), 0) as total
      FROM "InventoryTransaction"
      WHERE "itemId" = ${itemId} AND "organizationId" = ${orgId}`;
    return Number(result[0]?.total ?? 0);
  }

  /** Current stock with per-batch breakdown for a single item. */
  async getStockDetail(itemId: string) {
    const orgId = this.tenant.requireOrganizationId();
    const item = await this.prisma.prisma.inventoryItem.findUnique({ where: { id: itemId } });
    if (!item) throw new NotFoundException('Item not found');

    // Current stock
    const currentStock = await this.computeStock(itemId);

    // Per-batch breakdown
    const batches = await this.prisma.prisma.inventoryTransaction.groupBy({
      by: ['batchNumber'],
      where: {
        itemId,
        organizationId: orgId,
        batchNumber: { not: null },
      },
      _sum: {
        quantity: true,
      },
    });

    const batchStock = batches.map((b) => ({
      batchNumber: b.batchNumber,
      quantity: Number(b._sum.quantity ?? 0),
    }));

    // Find the earliest expiry per batch
    const batchExpiries = await this.prisma.prisma.inventoryTransaction.findMany({
      where: {
        itemId,
        organizationId: orgId,
        batchNumber: { not: null },
        expiryDate: { not: null },
      },
      orderBy: { expiryDate: 'asc' },
      select: { batchNumber: true, expiryDate: true },
    });

    const expiryMap = new Map<string, Date>();
    for (const row of batchExpiries) {
      if (row.batchNumber && !expiryMap.has(row.batchNumber)) {
        expiryMap.set(row.batchNumber, row.expiryDate!);
      }
    }

    return {
      itemId,
      itemName: item.name,
      code: item.code,
      unit: item.unit,
      currentStock,
      batches: batchStock.map((b) => ({
        batchNumber: b.batchNumber,
        quantity: b.quantity,
        expiryDate: expiryMap.get(b.batchNumber!)?.toISOString() ?? null,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Stock In / Stock Out
  // ---------------------------------------------------------------------------

  async recordTransaction(dto: CreateTransactionDto) {
    const orgId = this.tenant.requireOrganizationId();
    const userId = this.tenant.requireUserId();
    const item = await this.prisma.prisma.inventoryItem.findUnique({ where: { id: dto.itemId } });
    if (!item) throw new NotFoundException('Item not found');
    if (!item.active) throw new BadRequestException('Cannot record transaction for an inactive item');

    // Prevent negative stock on stock-out
    if (dto.direction === InventoryDirection.out) {
      const currentStock = await this.computeStock(dto.itemId);
      if (currentStock < dto.quantity) {
        throw new BadRequestException(
          `Insufficient stock: ${currentStock} ${item.unit} available, ${dto.quantity} ${item.unit} requested`,
        );
      }
    }

    return this.prisma.prisma.inventoryTransaction.create({
      data: {
        organizationId: orgId,
        itemId: dto.itemId,
        direction: dto.direction,
        quantity: dto.quantity,
        batchNumber: dto.batchNumber ?? null,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : null,
        reason: dto.reason ?? null,
        actorUserId: userId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Low-stock & Expiring queries
  // ---------------------------------------------------------------------------

  /** Items where computed stock ≤ reorderThreshold (and threshold is set). */
  async getLowStock() {
    const orgId = this.tenant.requireOrganizationId();
    const items = await this.prisma.prisma.inventoryItem.findMany({
      where: {
        organizationId: orgId,
        active: true,
        reorderThreshold: { not: null },
      },
      include: { preferredSupplier: { select: { id: true, name: true } } },
    });

    const result = [];
    for (const item of items) {
      const stock = await this.computeStock(item.id);
      if (stock <= (item.reorderThreshold ?? Infinity)) {
        result.push({ ...item, currentStock: stock });
      }
    }
    return result;
  }

  /** Batches with expiryDate within `days` of now, or already past. */
  async getExpiring(days = 30) {
    const orgId = this.tenant.requireOrganizationId();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() + days);

    const rows = await this.prisma.prisma.inventoryTransaction.findMany({
      where: {
        organizationId: orgId,
        direction: InventoryDirection.in,
        expiryDate: { not: null, lte: cutoff },
      },
      include: {
        item: { select: { id: true, code: true, name: true, unit: true } },
      },
      orderBy: { expiryDate: 'asc' },
    });

    // Group by batchNumber + item, keep earliest expiry
    const seen = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      const key = `${row.itemId}:${row.batchNumber ?? ''}`;
      if (!seen.has(key)) seen.set(key, row);
    }

    return Array.from(seen.values()).map((row) => ({
      itemId: row.itemId,
      itemCode: row.item.code,
      itemName: row.item.name,
      unit: row.item.unit,
      batchNumber: row.batchNumber,
      expiryDate: row.expiryDate?.toISOString() ?? null,
    }));
  }

  // ---------------------------------------------------------------------------
  // Alerts (for the bell icon / inbox)
  // ---------------------------------------------------------------------------

  /** Total count of active alerts (low-stock + expiring) for the bell badge. */
  async alertCount(): Promise<number> {
    const lowStock = await this.getLowStock();
    const expiring = await this.getExpiring();
    return lowStock.length + expiring.length;
  }

  /** Combined alert list for the inbox. */
  async listAlerts() {
    const lowStock = await this.getLowStock();
    const expiring = await this.getExpiring();

    const alerts: Array<{
      id: string;
      type: 'low_stock' | 'expiring';
      message: string;
      itemName: string;
      itemCode: string;
      detail: string;
    }> = [];

    for (const item of lowStock) {
      alerts.push({
        id: `low-stock-${item.id}`,
        type: 'low_stock',
        message: `Low stock: ${item.name}`,
        itemName: item.name,
        itemCode: item.code,
        detail: `${item.currentStock} ${item.unit} remaining (threshold: ${item.reorderThreshold} ${item.unit})`,
      });
    }

    for (const batch of expiring) {
      alerts.push({
        id: `expiring-${batch.itemId}-${batch.batchNumber ?? 'no-batch'}`,
        type: 'expiring',
        message: `Expiring: ${batch.itemName}`,
        itemName: batch.itemName,
        itemCode: batch.itemCode,
        detail: `Batch ${batch.batchNumber ?? 'N/A'} expires ${batch.expiryDate ? new Date(batch.expiryDate).toLocaleDateString('en-IN') : 'unknown'}`,
      });
    }

    return alerts;
  }
}
