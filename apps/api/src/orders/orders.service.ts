import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Order, Prisma } from '@prisma/client';
import { deriveInvoiceStatus, normalizeAndValidateSplits, roundMoney, sumSplits } from '../billing/payment.util';
import { SYSTEM_USER_ID } from '../common/constants';
import { PatientsService } from '../patients/patients.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { BillingDto, CreateOrderDto } from './dto/create-order.dto';
import { computeOrderStatus } from './order-status.util';
import { computeOrderTotal } from './order-totals.util';
import { distributePackagePrice } from './package-pricing.util';
import { buildSampleBarcode } from '../samples/sample-barcode.util';

/** One OrderTest row to snapshot: a standalone test at its current price, or a
 *  package constituent at its share of the package's own price. Sample-type
 *  fields are carried for Stage 2 sample creation (one Sample per distinct
 *  required sample type among the ordered tests). */
interface ResolvedLineItem {
  testId: string;
  testName: string;
  price: Prisma.Decimal;
  requiredSampleTypeId: string | null;
  sampleTypeCode: string | null;
  sampleTypeName: string | null;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
    private readonly patients: PatientsService,
  ) {}

  /**
   * POST /api/orders — every step below runs inside ONE transaction.
   * See the §9 spec walkthrough in SETUP.md. Pricing is always server-side;
   * the frontend payload carries no prices by design.
   */
  async createOrder(dto: CreateOrderDto): Promise<unknown> {
    const orgId = this.tenant.requireOrganizationId();

    if ((!dto.testIds || dto.testIds.length === 0) && (!dto.packageIds || dto.packageIds.length === 0)) {
      throw new BadRequestException('At least one test or package must be ordered');
    }

    // Discount bounds are validated before any DB work (DTO bounds 0–100 too).
    const discountPercent = new Prisma.Decimal(dto.billing?.discountPercent ?? 0);
    this.validateDiscount(discountPercent);

    return this.prisma.prisma.$transaction(async (tx) => {
      // 1. Patient: link an existing one or register a new one in-transaction
      //    (running the duplicate-ready identity checks + collision-safe UID logic).
      let patientId = dto.patient.patientId ?? null;
      if (patientId) {
        const existing = await tx.patient.findUnique({ where: { id: patientId } });
        if (!existing) {
          throw new BadRequestException('Referenced patient does not exist');
        }
      } else {
        const created = await this.patients.createPatientInTx(tx, orgId, dto.patient);
        patientId = created.id;
      }

      // 2. Resolve testIds + expand packageIds into line items. Standalone
      //    tests bill at their MasterTest.currentPrice; a package bills at its
      //    OWN packagePrice (distributed across its constituent OrderTest rows).
      //    Prices are always looked up from the DB — any price the frontend
      //    might send is rejected outright by forbidNonWhitelisted + never used.
      const { items, subtotal } = await this.resolveOrderItems(tx, orgId, dto.testIds ?? [], dto.packageIds ?? []);

      // 3. Totals, computed server-side (discount already validated above).
      const total = computeOrderTotal(subtotal, discountPercent);

      // 4. Cross-verify any client-sent subtotal/total (defense-in-depth, §9.4).
      this.crossCheckBilling(dto.billing, subtotal, total);

      // 5. Referrer validation (optional).
      if (dto.orderDetails?.referrerPartyId) {
        const referrer = await tx.party.findFirst({ where: { id: dto.orderDetails.referrerPartyId } });
        if (!referrer) {
          throw new BadRequestException('Referrer party does not exist');
        }
      }

      // 6. Create the Order, then one Sample per distinct required sample type
      //    (Stage 2 — a CBC + LFT order needing the same tube type gets one
      //    Sample; different tube types get one each), then OrderTest rows
      //    linked to their Sample. Snapshots are captured NOW; barcodes are
      //    deterministic (order-id prefix + tube code), so no counter/race risk.
      const order = await tx.order.create({
        data: {
          organizationId: orgId,
          patientId,
          referrerPartyId: dto.orderDetails?.referrerPartyId ?? null,
          clinicalNotes: dto.orderDetails?.clinicalNotes ?? null,
          isUrgent: dto.orderDetails?.isUrgent ?? false,
          // Every line item starts pending → the derived rollup is 'billed'.
          status: computeOrderStatus(items.map(() => 'pending' as const)),
          subtotal,
          discountPercent,
          totalAmount: total,
          createdBy: SYSTEM_USER_ID,
        },
      });

      const sampleIdByType = new Map<string, string>();
      const sampleTypeIds = [
        ...new Set(items.map((t) => t.requiredSampleTypeId).filter((id): id is string => id != null)),
      ];
      for (const typeId of sampleTypeIds) {
        const first = items.find((t) => t.requiredSampleTypeId === typeId)!;
        const sample = await tx.sample.create({
          data: {
            organizationId: orgId,
            orderId: order.id,
            sampleTypeId: typeId,
            barcodeValue: buildSampleBarcode(order.id, first.sampleTypeCode, first.sampleTypeName),
          },
        });
        sampleIdByType.set(typeId, sample.id);
      }

      for (const t of items) {
        await tx.orderTest.create({
          data: {
            organizationId: orgId,
            orderId: order.id,
            testId: t.testId,
            testNameSnapshot: t.testName,
            snapshottedPrice: t.price,
            sampleId: t.requiredSampleTypeId ? (sampleIdByType.get(t.requiredSampleTypeId) ?? null) : null,
          },
        });
      }

      // 7. Invoice.
      const invoice = await tx.invoice.create({
        data: {
          organizationId: orgId,
          orderId: order.id,
          subtotal,
          discountPercent,
          totalAmount: total,
          status: 'due',
        },
      });

      // 8. Payment (only when splits are provided) — exact split-sum validation.
      if (dto.payment?.splits?.length) {
        const splits = normalizeAndValidateSplits(dto.payment.splits);
        const amountPaid = dto.payment.amount != null ? roundMoney(new Prisma.Decimal(dto.payment.amount)) : sumSplits(splits);
        if (!sumSplits(splits).equals(amountPaid)) {
          throw new BadRequestException('Payment splits do not sum exactly to the amount being paid');
        }
        await tx.payment.create({
          data: {
            organizationId: orgId,
            invoiceId: invoice.id,
            collectedBy: SYSTEM_USER_ID,
            splits: { create: splits.map((s) => ({ mode: s.mode, amount: s.amount })) },
          },
        });
        const status = deriveInvoiceStatus(amountPaid, total);
        if (status !== 'due') {
          await tx.invoice.update({ where: { id: invoice.id }, data: { status } });
        }
      }

      return tx.order.findFirst({
        where: { id: order.id },
        include: {
          patient: true,
          orderTests: true,
          invoice: { include: { payments: { include: { splits: true } } } },
        },
      });
    });
  }

  /** Read-only detail used by the Orders page's Samples section (Stage 2). */
  async getOrderDetail(id: string) {
    const order = await this.prisma.prisma.order.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, patientUid: true, firstName: true, lastName: true, gender: true, mobile: true } },
        orderTests: {
          select: { id: true, testNameSnapshot: true, snapshottedPrice: true, status: true, sampleId: true },
        },
        invoice: { select: { id: true, status: true, subtotal: true, discountPercent: true, totalAmount: true } },
        samples: {
          orderBy: { createdAt: 'asc' },
          include: {
            sampleType: { select: { id: true, name: true, code: true } },
            orderTests: { select: { id: true, testNameSnapshot: true } },
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  /** Minimal read endpoint so the web Orders page can verify created orders. */
  async listOrders(limit: number): Promise<Order[]> {
    return this.prisma.prisma.order.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        patient: { select: { id: true, patientUid: true, firstName: true, lastName: true, gender: true, mobile: true } },
        orderTests: { select: { id: true, testNameSnapshot: true, snapshottedPrice: true, status: true } },
        invoice: { select: { id: true, status: true, totalAmount: true } },
      },
    });
  }

  private validateDiscount(discountPercent: Prisma.Decimal): void {
    if (discountPercent.lessThan(0) || discountPercent.greaterThan(100)) {
      throw new BadRequestException('discountPercent must be between 0 and 100');
    }
  }

  /** §9.4 — reject client-supplied subtotal/total that disagree with the server. */
  private crossCheckBilling(billing: BillingDto | undefined, subtotal: Prisma.Decimal, total: Prisma.Decimal): void {
    if (billing?.subtotal !== undefined) {
      const given = roundMoney(new Prisma.Decimal(billing.subtotal));
      if (!given.equals(subtotal)) {
        throw new BadRequestException(
          `Cross-check failed: client subtotal ${given.toString()} does not match server-computed subtotal ${subtotal.toString()}`,
        );
      }
    }
    if (billing?.total !== undefined) {
      const given = roundMoney(new Prisma.Decimal(billing.total));
      if (!given.equals(total)) {
        throw new BadRequestException(
          `Cross-check failed: client total ${given.toString()} does not match server-computed total ${total.toString()}`,
        );
      }
    }
  }

  /**
   * Resolves the ordered line items into OrderTest snapshots with server-side
   * prices (never any client-supplied figure):
   *  - standalone tests bill at their CURRENT MasterTest.currentPrice;
   *  - packages bill at their OWN MasterTestPackage.packagePrice, distributed
   *    across the package's constituent OrderTest rows (proportionally to each
   *    test's standalone price) so the snapshot sum equals packagePrice exactly.
   * Overlap prevention: a test must never be billed BOTH standalone and inside
   * a package (that would double-bill it). The frontend resolves this with an
   * explicit confirm before submitting; if a request still overlaps, it is
   * rejected here with a BadRequestException rather than silently merged.
   */
  private async resolveOrderItems(
    tx: Prisma.TransactionClient,
    orgId: string,
    testIds: string[],
    packageIds: string[],
  ): Promise<{ items: ResolvedLineItem[]; subtotal: Prisma.Decimal }> {
    const items: ResolvedLineItem[] = [];

    // Standalone tests (dedupe repeated ids within the standalone list).
    const uniqueTestIds = [...new Set(testIds)];
    if (uniqueTestIds.length > 0) {
      const rows = await tx.masterTest.findMany({
        where: { id: { in: uniqueTestIds }, active: true },
        include: { requiredSampleType: { select: { code: true, name: true } } },
      });
      if (rows.length !== uniqueTestIds.length) {
        throw new BadRequestException('One or more selected tests do not exist or are inactive');
      }
      for (const row of rows) {
        items.push({
          testId: row.id,
          testName: row.testName,
          price: row.currentPrice,
          requiredSampleTypeId: row.requiredSampleTypeId,
          sampleTypeCode: row.requiredSampleType?.code ?? null,
          sampleTypeName: row.requiredSampleType?.name ?? null,
        });
      }
    }

    // Packages — each billed at its own packagePrice.
    const uniquePackageIds = [...new Set(packageIds)];
    if (uniquePackageIds.length > 0) {
      const packages = await tx.masterTestPackage.findMany({
        where: { id: { in: uniquePackageIds }, active: true },
        include: { items: true },
      });
      if (packages.length !== uniquePackageIds.length) {
        throw new BadRequestException('One or more selected packages do not exist or are inactive');
      }
      const itemTestIds = [...new Set(packages.flatMap((p) => p.items.map((i) => i.testId)))];
      const itemRows =
        itemTestIds.length > 0
          ? await tx.masterTest.findMany({
              where: { id: { in: itemTestIds }, active: true },
              include: { requiredSampleType: { select: { code: true, name: true } } },
            })
          : [];
      if (itemRows.length !== itemTestIds.length) {
        throw new BadRequestException('A selected package contains a test that is missing or inactive');
      }
      const priceById = new Map(itemRows.map((r) => [r.id, r.currentPrice]));
      const nameById = new Map(itemRows.map((r) => [r.id, r.testName]));

      // Overlap prevention (reject, never silently merge): a test selected
      // standalone must not also sit inside a selected package.
      const conflicts: string[] = [];
      for (const pkg of packages) {
        for (const item of pkg.items) {
          if (uniqueTestIds.includes(item.testId)) {
            const testName = nameById.get(item.testId) ?? 'Unknown test';
            conflicts.push(`'${testName}' is ordered both standalone and inside package '${pkg.packageName}'`);
          }
        }
      }
      if (conflicts.length > 0) {
        throw new BadRequestException(
          `Overlapping items cannot be billed twice: ${conflicts.join('; ')}. Remove the standalone item(s) or the package(s).`,
        );
      }

      const rowById = new Map(itemRows.map((r) => [r.id, r]));
      for (const pkg of packages) {
        const distributed = distributePackagePrice(pkg.packagePrice, pkg.items.map((i) => ({
          testId: i.testId,
          testName: nameById.get(i.testId) ?? 'Unknown test',
          standalonePrice: priceById.get(i.testId) ?? new Prisma.Decimal(0),
        })));
        for (const d of distributed) {
          const row = rowById.get(d.testId);
          items.push({
            testId: d.testId,
            testName: d.testName,
            price: d.price,
            requiredSampleTypeId: row?.requiredSampleTypeId ?? null,
            sampleTypeCode: row?.requiredSampleType?.code ?? null,
            sampleTypeName: row?.requiredSampleType?.name ?? null,
          });
        }
      }
    }

    const subtotal = roundMoney(items.reduce((acc, t) => acc.plus(t.price), new Prisma.Decimal(0)));
    return { items, subtotal };
  }
}
