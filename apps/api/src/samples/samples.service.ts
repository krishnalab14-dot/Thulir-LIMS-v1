import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RejectionReason, Sample } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { RejectSampleDto } from './dto/reject-sample.dto';
import { nextRecollectionBarcode } from './sample-barcode.util';

/** Worklist shape returned by GET /api/samples/pending. */
const PENDING_INCLUDE = {
  sampleType: { select: { id: true, name: true, code: true } },
  order: {
    select: {
      id: true,
      isUrgent: true,
      createdAt: true,
      patient: { select: { id: true, patientUid: true, firstName: true, lastName: true, mobile: true } },
    },
  },
} satisfies Prisma.SampleInclude;

const CHAIN_SELECT = {
  id: true,
  barcodeValue: true,
  status: true,
  createdAt: true,
  recollectionOfSampleId: true,
} satisfies Prisma.SampleSelect;

@Injectable()
export class SamplesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** GET /api/samples/pending — pending_collection samples, oldest first. */
  async listPending() {
    return this.prisma.prisma.sample.findMany({
      where: { status: 'pending_collection' },
      orderBy: { createdAt: 'asc' },
      include: PENDING_INCLUDE,
    });
  }

  /**
   * PUT /api/samples/:id/collect — concurrency-safe by construction.
   * Conditional update (`UPDATE … WHERE id AND status = pending_collection`);
   * zero rows affected ⇒ the sample is already collected/rejected ⇒ 409.
   */
  async collect(id: string): Promise<Sample> {
    this.tenant.requireOrganizationId();
    const updated = await this.prisma.prisma.sample.updateMany({
      where: { id, status: 'pending_collection' },
      data: { status: 'collected', collectedBy: this.tenant.requireUserId(), collectedAt: new Date() },
    });
    if (updated.count === 0) {
      throw new ConflictException('Sample is not pending collection — it has already been collected or rejected');
    }
    const sample = await this.prisma.prisma.sample.findUnique({ where: { id } });
    if (!sample) {
      throw new NotFoundException('Sample not found'); // defensive; the conditional update just matched it
    }
    return sample;
  }

  /**
   * PUT /api/samples/:id/reject — all inside ONE transaction:
   *   1. conditional update pending_collection → rejected (409 if not pending)
   *   2. auto-create a recollection Sample (same order + sample type, new
   *      barcode with -R2/-R3… suffix, recollectionOfSampleId → rejected row)
   *   3. re-link the affected OrderTest rows to the recollection
   * Billing (Order/Invoice/Payment) is never touched.
   * Returns the recollection so the UI can print/attach its label immediately.
   */
  async reject(id: string, dto: RejectSampleDto): Promise<Sample> {
    const orgId = this.tenant.requireOrganizationId();
    return this.prisma.prisma.$transaction(async (tx) => {
      const updated = await tx.sample.updateMany({
        where: { id, status: 'pending_collection' },
        data: {
          status: 'rejected',
          rejectedReason: dto.reason,
          rejectedReasonNote: dto.reason === RejectionReason.other ? (dto.note ?? null) : null,
          rejectedBy: this.tenant.requireUserId(),
          rejectedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        throw new ConflictException('Sample is not pending collection — it has already been collected or rejected');
      }
      const rejected = await tx.sample.findUnique({ where: { id } });
      if (!rejected) {
        throw new NotFoundException('Sample not found');
      }

      const recollection = await tx.sample.create({
        data: {
          organizationId: orgId,
          orderId: rejected.orderId,
          sampleTypeId: rejected.sampleTypeId,
          barcodeValue: nextRecollectionBarcode(rejected.barcodeValue),
          status: 'pending_collection',
          recollectionOfSampleId: rejected.id,
        },
      });

      await tx.orderTest.updateMany({
        where: { sampleId: rejected.id },
        data: { sampleId: recollection.id },
      });

      return recollection;
    });
  }

  /** GET /api/samples/:id — lifecycle detail + full recollection chain (root → latest). */
  async getDetail(id: string) {
    const sample = await this.prisma.prisma.sample.findUnique({
      where: { id },
      include: {
        sampleType: { select: { id: true, name: true, code: true } },
        order: {
          select: {
            id: true,
            isUrgent: true,
            createdAt: true,
            patient: { select: { id: true, patientUid: true, firstName: true, lastName: true, mobile: true } },
          },
        },
        orderTests: { select: { id: true, testId: true, testNameSnapshot: true, status: true } },
      },
    });
    if (!sample) {
      throw new NotFoundException('Sample not found');
    }
    return { ...sample, chain: await this.buildRecollectionChain(sample) };
  }

  /** GET /api/samples/:id/label — data for the printable collection label. */
  async getLabel(id: string) {
    const sample = await this.prisma.prisma.sample.findUnique({
      where: { id },
      include: {
        sampleType: { select: { name: true, code: true } },
        order: {
          select: {
            id: true,
            patient: { select: { firstName: true, lastName: true, patientUid: true } },
          },
        },
      },
    });
    if (!sample) {
      throw new NotFoundException('Sample not found');
    }
    const orgId = this.tenant.requireOrganizationId();
    const org = await this.prisma.prisma.organization.findUnique({ where: { id: orgId } });
    return {
      barcodeValue: sample.barcodeValue,
      patientName: `${sample.order.patient.firstName} ${sample.order.patient.lastName}`,
      patientUid: sample.order.patient.patientUid,
      sampleTypeName: sample.sampleType.name,
      orderId: sample.order.id,
      labName: org?.name ?? 'Thulir Lab',
    };
  }

  /**
   * Walks the recollection self-link both directions and returns the ordered
   * chain from the ORIGINAL sample to the LATEST one (the given sample sits
   * somewhere inside it). The chain is strictly linear by construction: a
   * rejected sample can never be rejected again (status gate), so each node
   * has at most one recollection.
   */
  private async buildRecollectionChain(sample: {
    id: string;
    orderId: string;
    recollectionOfSampleId: string | null;
  }) {
    const all = await this.prisma.prisma.sample.findMany({
      where: { orderId: sample.orderId },
      select: CHAIN_SELECT,
    });
    const byId = new Map(all.map((s) => [s.id, s]));

    // Walk up to the root (the sample with no recollectionOfSampleId).
    let root = byId.get(sample.id);
    if (!root) {
      return [];
    }
    let guard = 0;
    while (root.recollectionOfSampleId && guard < 50) {
      const parent = byId.get(root.recollectionOfSampleId);
      if (!parent) {
        break;
      }
      root = parent;
      guard++;
    }

    // Walk down from the root to the latest recollection.
    const chain: typeof all = [];
    let node = root;
    guard = 0;
    while (node && guard < 50) {
      chain.push(node);
      const next = all.find((s) => s.recollectionOfSampleId === node.id);
      if (!next) {
        break;
      }
      node = next;
      guard++;
    }
    return chain;
  }
}
