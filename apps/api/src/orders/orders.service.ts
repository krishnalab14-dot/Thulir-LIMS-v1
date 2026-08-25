import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Gender, Order, Prisma, ResultType } from '@prisma/client';
import { deriveInvoiceStatus, normalizeAndValidateSplits, roundMoney, sumSplits } from '../billing/payment.util';
import { patientAgeYears, resolveReferenceRange, ResolvedRange, SpecLike } from '../masters/reference-range.util';
import { PatientsService } from '../patients/patients.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { BillingDto, CreateOrderDto } from './dto/create-order.dto';
import { computeOrderStatus } from './order-status.util';
import { computeOrderTotal } from './order-totals.util';
import { distributePackagePrice } from './package-pricing.util';
import { buildDedicatedSampleBarcode, buildSampleBarcode } from '../samples/sample-barcode.util';
import { nextBillNo } from './bill-no.util';

/** One OrderTest row to snapshot: a standalone test at its current price, or a
 *  package constituent at its share of the package's own price. Sample-type
 *  fields are carried for Stage 2 sample creation (one Sample per distinct
 *  required sample type among the ordered tests); requiresDedicatedSample is
 *  the Stage 2.1 per-test override (true ⇒ that test gets its own tube even
 *  when another test on the order shares its sample type). */
interface ResolvedLineItem {
  testId: string;
  testName: string;
  price: Prisma.Decimal;
  requiredSampleTypeId: string | null;
  sampleTypeCode: string | null;
  sampleTypeName: string | null;
  requiresDedicatedSample: boolean;
  // Stage 2.5 result fields — used to resolve + snapshot the reference range
  // (and options/critical thresholds) at order time. Stage 3: the abnormal-
  // options parallel array is snapshotted too, so Result Entry can flag
  // qualitative results without ever re-reading MasterTest live. Stage 3
  // follow-up: unit is snapshotted alongside the rest.
  resultType: ResultType;
  resultOptions: string[];
  resultOptionsAbnormal: string[];
  defaultRefLow: number | null;
  defaultRefHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  unit: string | null;
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
      let patientAge = 0;
      let patientSex: Gender = 'other';
      if (patientId) {
        const existing = await tx.patient.findUnique({ where: { id: patientId } });
        if (!existing) {
          throw new BadRequestException('Referenced patient does not exist');
        }
        patientAge = patientAgeYears(existing);
        patientSex = existing.gender;
      } else {
        const created = await this.patients.createPatientInTx(tx, orgId, dto.patient);
        patientId = created.id;
        patientAge = patientAgeYears(created);
        patientSex = created.gender;
      }

      // 2. Resolve testIds + expand packageIds into line items. Standalone
      //    tests bill at their MasterTest.currentPrice; a package bills at its
      //    OWN packagePrice (distributed across its constituent OrderTest rows).
      //    Prices are always looked up from the DB — any price the frontend
      //    might send is rejected outright by forbidNonWhitelisted + never used.
      const { items, subtotal } = await this.resolveOrderItems(tx, orgId, dto.testIds ?? [], dto.packageIds ?? []);

      // 2.5 Stage 2.5: resolve the reference range for every NUMERIC test at
      //    this exact moment (§2 — spec match → any-sex spec → default). A
      //    numeric test with no default range and no matching specification is
      //    rejected outright (never snapshot a null/undefined range). The
      //    resolved values are snapshotted below and are NEVER re-read live
      //    from MasterTest/TestSpecification afterwards.
      const specRows = await tx.testSpecification.findMany({
        where: { testId: { in: items.map((t) => t.testId) } },
      });
      const specsByTest = new Map<string, SpecLike[]>();
      for (const s of specRows) {
        const list = specsByTest.get(s.testId) ?? [];
        list.push({ ageMinYears: s.ageMinYears, ageMaxYears: s.ageMaxYears, sex: s.sex, refLow: s.refLow, refHigh: s.refHigh });
        specsByTest.set(s.testId, list);
      }
      const resolvedRangeByTest = new Map<string, ResolvedRange>();
      const noRange: string[] = [];
      for (const t of items) {
        if (t.resultType !== ResultType.numeric) {
          continue;
        }
        const range = resolveReferenceRange(specsByTest.get(t.testId) ?? [], t, patientAge, patientSex);
        if (!range) {
          noRange.push(t.testName);
        } else {
          resolvedRangeByTest.set(t.testId, range);
        }
      }
      if (noRange.length > 0) {
        throw new BadRequestException(
          `Cannot order: ${noRange.join(', ')} has no reference range for this patient. Define a default range or a matching age/sex specification in Masters first.`,
        );
      }

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

      // 6. Discount authorization audit — when a discount is applied,
      //    record which authenticated staff member authorized it (always
      //    the current JWT user, never client-supplied). Required when
      //    discountPercent > 0; server-side enforced regardless of client.
      const discountPctNum = Number(discountPercent);
      const discountAuthorizedBy = discountPctNum > 0 ? this.tenant.requireUserId() : null;

      // 7. Create the Order, then Samples + OrderTest rows (Stage 2 / 2.1).
      //    Grouping rule: NON-dedicated tests share one Sample per distinct
      //    required sample type (a CBC + LFT order needing the same tube gets
      //    one Sample); each requiresDedicatedSample test gets its OWN Sample
      //    even if another test on the order has the identical sample type.
      //    Snapshots are captured NOW; barcodes are deterministic (full order
      //    id + tube code, + full test id for dedicated samples), so there is
      //    no counter/race risk under parallel order creation.
      // Sequential human-friendly bill number (THU-BILL-2026-0001) — same
      // atomic-counter pattern as patientUid, separate counter namespace.
      const org = await tx.organization.findUnique({ where: { id: orgId } });
      if (!org) {
        throw new BadRequestException('Organization not found');
      }
      const billNo = await nextBillNo(tx, org, new Date().getFullYear());

      const order = await tx.order.create({
        data: {
          organizationId: orgId,
          billNo,
          patientId,
          referrerPartyId: dto.orderDetails?.referrerPartyId ?? null,
          clinicalNotes: dto.orderDetails?.clinicalNotes ?? null,
          isUrgent: dto.orderDetails?.isUrgent ?? false,
          // Every line item starts pending → the derived rollup is 'billed'.
          status: computeOrderStatus(items.map(() => 'pending' as const)),
          subtotal,
          discountPercent,
          totalAmount: total,
          createdBy: this.tenant.requireUserId(),
          discountAuthorizedBy,
          expectedReportDate: dto.orderDetails?.expectedReportDate ?? null,
          scheduledCollectionAt: dto.orderDetails?.scheduledCollectionAt ?? null,
          patientType: dto.orderDetails?.patientType ?? null,
          wardDesc: dto.orderDetails?.wardDesc ?? null,
          bedNo: dto.orderDetails?.bedNo ?? null,
          ipOpNo: dto.orderDetails?.ipOpNo ?? null,
          source: dto.orderDetails?.source ?? null,
          billGroupId: dto.orderDetails?.billGroupId ?? null,
        },
      });

      // Shared (non-dedicated) tests: one Sample per distinct required type.
      const sampleIdByType = new Map<string, string>();
      const sharedItems = items.filter((t) => !t.requiresDedicatedSample);
      const sharedTypeIds = [
        ...new Set(sharedItems.map((t) => t.requiredSampleTypeId).filter((id): id is string => id != null)),
      ];
      for (const typeId of sharedTypeIds) {
        const first = sharedItems.find((t) => t.requiredSampleTypeId === typeId)!;
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

      // Dedicated tests: one Sample per test. Dedupe by testId — the same test
      // selected twice in one order (e.g. via two overlapping packages) is the
      // same physical tube and must not generate a duplicate barcode; this
      // keeps barcode uniqueness guaranteed by construction, not by luck.
      const dedicatedSampleIdByTest = new Map<string, string>();
      for (const t of items.filter((item) => item.requiresDedicatedSample)) {
        if (!t.requiredSampleTypeId || dedicatedSampleIdByTest.has(t.testId)) {
          continue;
        }
        const sample = await tx.sample.create({
          data: {
            organizationId: orgId,
            orderId: order.id,
            sampleTypeId: t.requiredSampleTypeId,
            barcodeValue: buildDedicatedSampleBarcode(order.id, t.sampleTypeCode, t.sampleTypeName, t.testId),
          },
        });
        dedicatedSampleIdByTest.set(t.testId, sample.id);
      }

      for (const t of items) {
        let sampleId: string | null = null;
        if (t.requiredSampleTypeId) {
          sampleId = t.requiresDedicatedSample
            ? (dedicatedSampleIdByTest.get(t.testId) ?? null)
            : (sampleIdByType.get(t.requiredSampleTypeId) ?? null);
        }
        // Stage 2.5 snapshots: resultType always; resultOptions when options;
        // resolved refLow/refHigh when numeric (already validated above);
        // critical thresholds copied directly from MasterTest (captured now
        // for a later alerting stage — not resolution-dependent).
        const range = resolvedRangeByTest.get(t.testId);
        await tx.orderTest.create({
          data: {
            organizationId: orgId,
            orderId: order.id,
            testId: t.testId,
            testNameSnapshot: t.testName,
            snapshottedPrice: t.price,
            sampleId,
            snapshottedResultType: t.resultType,
            snapshottedResultOptions: t.resultType === ResultType.options ? t.resultOptions : Prisma.JsonNull,
            snapshottedResultOptionsAbnormal: t.resultType === ResultType.options ? t.resultOptionsAbnormal : [],
            snapshottedRefLow: range?.refLow ?? null,
            snapshottedRefHigh: range?.refHigh ?? null,
            snapshottedCriticalLow: t.criticalLow,
            snapshottedCriticalHigh: t.criticalHigh,
            snapshottedUnit: t.unit,
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
            collectedBy: this.tenant.requireUserId(),
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
          samples: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              barcodeValue: true,
              sampleType: { select: { name: true, code: true } },
            },
          },
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
        items.push(this.toResolvedItem(row));
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

      // Overlap prevention (reject, never silently merge):
      //   a) a test selected standalone must not also sit inside a selected
      //      package (the standalone+package rule, Stage 1 follow-up 1);
      //   b) two distinct packages must not share a constituent test — that
      //      would bill the shared test twice across two independently-priced
      //      bundles, and there is no safe way to "remove just that test" from
      //      either package without inventing a partial price-redistribution
      //      rule (Stage 1 follow-up 2). The frontend resolves (b) with an
      //      explicit swap ("Remove RFT & add Kidney Panel") before
      //      submitting; if a request still arrives overlapping, it is
      //      rejected here rather than silently merged.
      const conflicts: string[] = [];
      for (const pkg of packages) {
        for (const item of pkg.items) {
          if (uniqueTestIds.includes(item.testId)) {
            const testName = nameById.get(item.testId) ?? 'Unknown test';
            conflicts.push(`'${testName}' is ordered both standalone and inside package '${pkg.packageName}'`);
          }
        }
      }
      for (let i = 0; i < packages.length; i++) {
        for (let j = i + 1; j < packages.length; j++) {
          const a = packages[i];
          const b = packages[j];
          const aTestIds = new Set(a.items.map((item) => item.testId));
          for (const item of b.items) {
            if (aTestIds.has(item.testId)) {
              const testName = nameById.get(item.testId) ?? 'Unknown test';
              conflicts.push(
                `'${testName}' is included in both package '${a.packageName}' and package '${b.packageName}'`,
              );
            }
          }
        }
      }
      if (conflicts.length > 0) {
        throw new BadRequestException(
          `Overlapping items cannot be billed twice: ${conflicts.join('; ')}. Remove the duplicated item(s) or one of the conflicting packages.`,
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
          const item = row ? this.toResolvedItem(row) : null;
          items.push({
            testId: d.testId,
            testName: d.testName,
            price: d.price,
            requiredSampleTypeId: item?.requiredSampleTypeId ?? null,
            sampleTypeCode: item?.sampleTypeCode ?? null,
            sampleTypeName: item?.sampleTypeName ?? null,
            requiresDedicatedSample: item?.requiresDedicatedSample ?? false,
            resultType: item?.resultType ?? ResultType.text,
            resultOptions: item?.resultOptions ?? [],
            resultOptionsAbnormal: item?.resultOptionsAbnormal ?? [],
            defaultRefLow: item?.defaultRefLow ?? null,
            defaultRefHigh: item?.defaultRefHigh ?? null,
            criticalLow: item?.criticalLow ?? null,
            criticalHigh: item?.criticalHigh ?? null,
            unit: item?.unit ?? null,
          });
        }
      }
    }

    const subtotal = roundMoney(items.reduce((acc, t) => acc.plus(t.price), new Prisma.Decimal(0)));
    return { items, subtotal };
  }

  /** Maps a MasterTest row into a ResolvedLineItem (Stage 2.5 result fields included). */
  private toResolvedItem(row: {
    id: string;
    testName: string;
    currentPrice: Prisma.Decimal;
    requiredSampleTypeId: string | null;
    requiresDedicatedSample: boolean;
    resultType: ResultType;
    resultOptions: string[];
    resultOptionsAbnormal: string[];
    defaultRefLow: number | null;
    defaultRefHigh: number | null;
    criticalLow: number | null;
    criticalHigh: number | null;
    unit?: string | null;
    requiredSampleType?: { code: string | null; name: string } | null;
  }): ResolvedLineItem {
    return {
      testId: row.id,
      testName: row.testName,
      price: row.currentPrice,
      requiredSampleTypeId: row.requiredSampleTypeId,
      sampleTypeCode: row.requiredSampleType?.code ?? null,
      sampleTypeName: row.requiredSampleType?.name ?? null,
      requiresDedicatedSample: row.requiresDedicatedSample,
      resultType: row.resultType,
      resultOptions: row.resultOptions,
      resultOptionsAbnormal: row.resultOptionsAbnormal ?? [],
      defaultRefLow: row.defaultRefLow,
      defaultRefHigh: row.defaultRefHigh,
      criticalLow: row.criticalLow,
      criticalHigh: row.criticalHigh,
      unit: row.unit ?? null,
    };
  }
}
