import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Gender, Prisma, ResultType } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { CreateSampleTypeDto } from './dto/create-sample-type.dto';
import { CreateTestDto } from './dto/create-test.dto';
import { UpdateTestDto } from './dto/update-test.dto';
import { specificationsOverlap } from './reference-range.util';

@Injectable()
export class MastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Live typeahead for the order screen — minimal fields only. Also returns matching packages so panels like CBC are discoverable from the test search. */
  async searchTests(q?: string) {
    const term = (q ?? '').trim();
    const [tests, packages] = await Promise.all([
      this.prisma.prisma.masterTest.findMany({
        where: {
          active: true,
          ...(term
            ? {
                OR: [
                  { testCode: { contains: term, mode: 'insensitive' } },
                  { testName: { contains: term, mode: 'insensitive' } },
                ],
              }
            : {}),
      },
      orderBy: { testName: 'asc' },
      take: 20,
      select: { id: true, testCode: true, testName: true, currentPrice: true, requiredSampleTypeId: true },
    }),
      term
        ? this.prisma.prisma.masterTestPackage.findMany({
            where: {
              active: true,
              OR: [
                { packageCode: { contains: term, mode: 'insensitive' } },
                { packageName: { contains: term, mode: 'insensitive' } },
              ],
            },
            orderBy: { packageName: 'asc' },
            take: 10,
            select: { id: true, packageCode: true, packageName: true, packagePrice: true },
          })
        : Promise.resolve([]),
    ]);

    return [
      ...tests.map((t) => ({ ...t, kind: 'test' as const })),
      ...packages.map((p) => ({
        id: p.id,
        testCode: p.packageCode,
        testName: p.packageName,
        currentPrice: p.packagePrice,
        requiredSampleTypeId: null,
        kind: 'package' as const,
      })),
    ];
  }

  /**
   * Package typeahead. A package bills at its OWN packagePrice (server-side
   * rule), so this returns the authoritative price plus the constituent test
   * names (for display); the per-item prices are informational only and never
   * used for billing.
   */
  async searchPackages(q?: string) {
    const term = (q ?? '').trim();
    const packages = await this.prisma.prisma.masterTestPackage.findMany({
      where: {
        active: true,
        ...(term
          ? {
              OR: [
                { packageCode: { contains: term, mode: 'insensitive' } },
                { packageName: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { packageName: 'asc' },
      take: 20,
      include: { items: { include: { test: { select: { id: true, testName: true, currentPrice: true } } } } },
    });
    return packages.map((p) => ({
      id: p.id,
      packageCode: p.packageCode,
      packageName: p.packageName,
      packagePrice: p.packagePrice,
      items: p.items.map((item) => ({ testId: item.testId, testName: item.test.testName, price: item.test.currentPrice })),
    }));
  }

  /** Full list for the minimal Masters page (incl. Stage 2.5 result fields + specs). */
  async listTests() {
    return this.prisma.prisma.masterTest.findMany({
      where: { active: true },
      orderBy: { testName: 'asc' },
      include: {
        requiredSampleType: { select: { id: true, name: true } },
        specifications: {
          orderBy: [{ ageMinYears: 'asc' }, { ageMaxYears: 'asc' }],
          select: { id: true, ageMinYears: true, ageMaxYears: true, sex: true, refLow: true, refHigh: true },
        },
      },
    });
  }

  async listSampleTypes() {
    return this.prisma.prisma.sampleType.findMany({ where: { active: true }, orderBy: { name: 'asc' } });
  }

  async createSampleType(dto: CreateSampleTypeDto) {
    const orgId = this.tenant.requireOrganizationId();
    return this.prisma.prisma.sampleType.create({ data: { organizationId: orgId, name: dto.name.trim() } });
  }

  async createTest(dto: CreateTestDto) {
    const orgId = this.tenant.requireOrganizationId();
    if (dto.requiredSampleTypeId) {
      const sampleType = await this.prisma.prisma.sampleType.findFirst({ where: { id: dto.requiredSampleTypeId } });
      if (!sampleType) {
        throw new BadRequestException('requiredSampleTypeId does not exist');
      }
    }

    const resultType = dto.resultType ?? ResultType.numeric;
    if (resultType === ResultType.options && (!dto.resultOptions || dto.resultOptions.length === 0)) {
      throw new BadRequestException('An options-type test must define at least one result option');
    }

    // Stage 3: resultOptionsAbnormal is only meaningful for options-type
    // tests and must be a subset of resultOptions — a data-entry error
    // caught here, not something Result Entry should ever have to handle.
    const resultOptionsAbnormal = (dto.resultOptionsAbnormal ?? []).filter((o) => o !== '');
    if (resultOptionsAbnormal.length > 0 && resultType !== ResultType.options) {
      throw new BadRequestException('resultOptionsAbnormal only applies to options-type tests');
    }
    if (resultOptionsAbnormal.length > 0) {
      const options = new Set(dto.resultOptions ?? []);
      const unknown = resultOptionsAbnormal.filter((o) => !options.has(o));
      if (unknown.length > 0) {
        throw new BadRequestException(`resultOptionsAbnormal contains options not in resultOptions: ${unknown.join(', ')}`);
      }
    }

    const specs = (dto.specifications ?? []).map((s) => ({
      ...s,
      sex: s.sex ?? null,
    }));
    this.validateSpecifications(specs);

    return this.prisma.prisma.masterTest.create({
      data: {
        organizationId: orgId,
        testCode: dto.testCode.trim().toUpperCase(),
        testName: dto.testName.trim(),
        currentPrice: new Prisma.Decimal(dto.currentPrice),
        requiredSampleTypeId: dto.requiredSampleTypeId ?? null,
        requiresDedicatedSample: dto.requiresDedicatedSample ?? false,
        resultType,
        unit: dto.unit?.trim() || null,
        resultOptions: resultType === ResultType.options ? (dto.resultOptions ?? []) : [],
        resultOptionsAbnormal: resultType === ResultType.options ? resultOptionsAbnormal : [],
        defaultRefLow: dto.defaultRefLow ?? null,
        defaultRefHigh: dto.defaultRefHigh ?? null,
        criticalLow: dto.criticalLow ?? null,
        criticalHigh: dto.criticalHigh ?? null,
        specifications:
          specs.length > 0
            ? { create: specs.map((s) => ({ organizationId: orgId, ageMinYears: s.ageMinYears, ageMaxYears: s.ageMaxYears, sex: s.sex, refLow: s.refLow, refHigh: s.refHigh })) }
            : undefined,
      },
      include: {
        requiredSampleType: { select: { id: true, name: true } },
        specifications: {
          orderBy: [{ ageMinYears: 'asc' }, { ageMaxYears: 'asc' }],
          select: { id: true, ageMinYears: true, ageMaxYears: true, sex: true, refLow: true, refHigh: true },
        },
      },
    });
  }

  /**
   * §2 overlap validation — data-entry error, caught at save time so Result
   * Entry never has to disambiguate ranges at runtime. Rejects any pair of
   * specs (within this request) that share the same sex tier (both any-sex,
   * or the same exact sex) AND an overlapping age range, naming the conflict.
   */
  private validateSpecifications(
    specs: { ageMinYears: number; ageMaxYears: number; sex: Gender | null; refLow: number; refHigh: number }[],
  ): void {
    for (let i = 0; i < specs.length; i++) {
      const a = specs[i];
      if (a.ageMinYears > a.ageMaxYears) {
        throw new BadRequestException(
          `Specification ${i + 1}: ageMinYears (${a.ageMinYears}) must not exceed ageMaxYears (${a.ageMaxYears})`,
        );
      }
      if (a.refLow > a.refHigh) {
        throw new BadRequestException(
          `Specification ${i + 1}: refLow (${a.refLow}) must not exceed refHigh (${a.refHigh})`,
        );
      }
      for (let j = i + 1; j < specs.length; j++) {
        const b = specs[j];
        if (specificationsOverlap(a, b)) {
          const sexLabel = a.sex === null ? 'any sex' : `sex=${a.sex}`;
          throw new BadRequestException(
            `Specifications ${i + 1} and ${j + 1} overlap for the same test: both apply to ${sexLabel} and ages ${a.ageMinYears}-${a.ageMaxYears} intersect ${b.ageMinYears}-${b.ageMaxYears}. Age/sex ranges must not overlap.`,
          );
        }
      }
    }
  }

  /** PATCH /masters/tests/:id — partial update, replaces specifications if provided. */
  async updateTest(id: string, dto: UpdateTestDto) {
    const orgId = this.tenant.requireOrganizationId();
    const existing = await this.prisma.prisma.masterTest.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('Test not found');

    if (dto.requiredSampleTypeId !== undefined && dto.requiredSampleTypeId !== null) {
      const sampleType = await this.prisma.prisma.sampleType.findFirst({ where: { id: dto.requiredSampleTypeId } });
      if (!sampleType) throw new BadRequestException('requiredSampleTypeId does not exist');
    }

    const resultType = dto.resultType ?? existing.resultType;
    if (resultType === ResultType.options && dto.resultOptions !== undefined && dto.resultOptions.length === 0) {
      throw new BadRequestException('An options-type test must define at least one result option');
    }

    const resultOptionsAbnormal = ((dto.resultOptionsAbnormal ?? existing.resultOptionsAbnormal) as string[]).filter((o) => o !== '');
    if (resultOptionsAbnormal.length > 0 && resultType !== ResultType.options) {
      throw new BadRequestException('resultOptionsAbnormal only applies to options-type tests');
    }
    if (resultOptionsAbnormal.length > 0 && dto.resultOptions) {
      const options = new Set(dto.resultOptions);
      const unknown = resultOptionsAbnormal.filter((o) => !options.has(o));
      if (unknown.length > 0) {
        throw new BadRequestException(`resultOptionsAbnormal contains options not in resultOptions: ${unknown.join(', ')}`);
      }
    }

    // Build the scalar update data — only overwrite fields that were explicitly sent.
    const data: Prisma.MasterTestUpdateInput = {};
    if (dto.testCode !== undefined) data.testCode = dto.testCode.trim().toUpperCase();
    if (dto.testName !== undefined) data.testName = dto.testName.trim();
    if (dto.currentPrice !== undefined) data.currentPrice = new Prisma.Decimal(dto.currentPrice);
    if (dto.requiredSampleTypeId !== undefined) data.requiredSampleType = dto.requiredSampleTypeId ? { connect: { id: dto.requiredSampleTypeId } } : { disconnect: true };
    if (dto.requiresDedicatedSample !== undefined) data.requiresDedicatedSample = dto.requiresDedicatedSample;
    if (dto.unit !== undefined) data.unit = dto.unit?.trim() || null;
    if (dto.resultType !== undefined) data.resultType = dto.resultType;
    if (dto.resultOptions !== undefined) {
      data.resultOptions = resultType === ResultType.options ? dto.resultOptions : [];
    }
    if (dto.resultOptionsAbnormal !== undefined) {
      data.resultOptionsAbnormal = resultType === ResultType.options ? resultOptionsAbnormal : [];
    }
    if (dto.defaultRefLow !== undefined) data.defaultRefLow = dto.defaultRefLow;
    if (dto.defaultRefHigh !== undefined) data.defaultRefHigh = dto.defaultRefHigh;
    if (dto.criticalLow !== undefined) data.criticalLow = dto.criticalLow;
    if (dto.criticalHigh !== undefined) data.criticalHigh = dto.criticalHigh;

    // Validate and replace specifications if provided.
    if (dto.specifications !== undefined) {
      const specs = dto.specifications.map((s) => ({
        ageMinYears: s.ageMinYears ?? 0,
        ageMaxYears: s.ageMaxYears ?? 120,
        sex: s.sex ?? null,
        refLow: s.refLow ?? 0,
        refHigh: s.refHigh ?? 0,
      }));
      this.validateSpecifications(specs);

      // Replace: delete existing, create new.
      await this.prisma.prisma.testSpecification.deleteMany({ where: { testId: id } });
      if (specs.length > 0) {
        await this.prisma.prisma.testSpecification.createMany({
          data: specs.map((s) => ({
            organizationId: orgId,
            testId: id,
            ageMinYears: s.ageMinYears,
            ageMaxYears: s.ageMaxYears,
            sex: s.sex,
            refLow: s.refLow,
            refHigh: s.refHigh,
          })),
        });
      }
    }

    return this.prisma.prisma.masterTest.update({
      where: { id },
      data,
      include: {
        requiredSampleType: { select: { id: true, name: true } },
        specifications: {
          orderBy: [{ ageMinYears: 'asc' }, { ageMaxYears: 'asc' }],
          select: { id: true, ageMinYears: true, ageMaxYears: true, sex: true, refLow: true, refHigh: true },
        },
      },
    });
  }

  /** Soft-deactivate a test (admin-only). */
  async deactivateTest(id: string) {
    const orgId = this.tenant.requireOrganizationId();
    const existing = await this.prisma.prisma.masterTest.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!existing) throw new NotFoundException('Test not found');
    return this.prisma.prisma.masterTest.update({
      where: { id },
      data: { active: !existing.active },
      select: { id: true, active: true },
    });
  }

  /** Inline package creation — reusable MasterTestPackage, visible to fresh searches immediately. */
  async createPackage(dto: CreatePackageDto) {
    const orgId = this.tenant.requireOrganizationId();
    const testIds = [...new Set(dto.testIds)];

    const tests = await this.prisma.prisma.masterTest.findMany({
      where: { id: { in: testIds }, active: true },
      select: { id: true },
    });
    if (tests.length !== testIds.length) {
      throw new BadRequestException('One or more testIds do not exist or are inactive');
    }

    const packageCode = `PKG-${randomBytes(3).toString('hex').toUpperCase()}`;
    const pkg = await this.prisma.prisma.masterTestPackage.create({
      data: {
        organizationId: orgId,
        packageCode,
        packageName: dto.packageName.trim(),
        packagePrice: new Prisma.Decimal(dto.packagePrice),
        items: { create: testIds.map((testId) => ({ testId })) },
      },
      include: { items: { include: { test: { select: { id: true, testName: true, currentPrice: true } } } } },
    });

    return {
      id: pkg.id,
      packageCode: pkg.packageCode,
      packageName: pkg.packageName,
      packagePrice: pkg.packagePrice,
      items: pkg.items.map((item) => ({ testId: item.testId, testName: item.test.testName, price: item.test.currentPrice })),
    };
  }
}
