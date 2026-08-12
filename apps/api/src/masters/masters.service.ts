import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { CreatePackageDto } from './dto/create-package.dto';
import { CreateSampleTypeDto } from './dto/create-sample-type.dto';
import { CreateTestDto } from './dto/create-test.dto';

@Injectable()
export class MastersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Live typeahead for the order screen — minimal fields only. */
  async searchTests(q?: string) {
    const term = (q ?? '').trim();
    return this.prisma.prisma.masterTest.findMany({
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
    });
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

  /** Full list for the minimal Masters page. */
  async listTests() {
    return this.prisma.prisma.masterTest.findMany({
      where: { active: true },
      orderBy: { testName: 'asc' },
      include: { requiredSampleType: { select: { id: true, name: true } } },
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
    return this.prisma.prisma.masterTest.create({
      data: {
        organizationId: orgId,
        testCode: dto.testCode.trim().toUpperCase(),
        testName: dto.testName.trim(),
        currentPrice: new Prisma.Decimal(dto.currentPrice),
        requiredSampleTypeId: dto.requiredSampleTypeId ?? null,
      },
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
