import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';

@Injectable()
export class LookupItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** List active items for a category. */
  async list(category: string) {
    const orgId = this.tenant.requireOrganizationId();
    return this.prisma.prisma.lookupItem.findMany({
      where: { organizationId: orgId, category, active: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** List ALL items (including inactive) for admin management. */
  async listAll(category: string) {
    const orgId = this.tenant.requireOrganizationId();
    return this.prisma.prisma.lookupItem.findMany({
      where: { organizationId: orgId, category },
      orderBy: { sortOrder: 'asc' },
    });
  }

  /** Create a new lookup item. */
  async create(category: string, value: string, sortOrder?: number) {
    const orgId = this.tenant.requireOrganizationId();
    if (!value.trim()) throw new BadRequestException('Value is required');
    return this.prisma.prisma.lookupItem.create({
      data: {
        organizationId: orgId,
        category,
        value: value.trim(),
        sortOrder: sortOrder ?? 0,
      },
    });
  }

  /** Toggle active/inactive (disable/enable). */
  async toggleActive(id: string, active: boolean) {
    const orgId = this.tenant.requireOrganizationId();
    const item = await this.prisma.prisma.lookupItem.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!item) throw new NotFoundException('Lookup item not found');
    return this.prisma.prisma.lookupItem.update({
      where: { id },
      data: { active },
    });
  }

  /** Update value and/or sort order. */
  async update(id: string, data: { value?: string; sortOrder?: number }) {
    const orgId = this.tenant.requireOrganizationId();
    const item = await this.prisma.prisma.lookupItem.findFirst({
      where: { id, organizationId: orgId },
    });
    if (!item) throw new NotFoundException('Lookup item not found');
    if (data.value !== undefined && !data.value.trim()) {
      throw new BadRequestException('Value cannot be empty');
    }
    return this.prisma.prisma.lookupItem.update({
      where: { id },
      data: {
        ...(data.value !== undefined ? { value: data.value.trim() } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
      },
    });
  }

  /** Seed initial titles for an org (idempotent — skips existing values). */
  async seedTitles(orgId: string, titles: string[]) {
    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (let i = 0; i < titles.length; i++) {
      ops.push(
        this.prisma.prisma.lookupItem.upsert({
          where: {
            organizationId_category_value: {
              organizationId: orgId,
              category: 'title',
              value: titles[i],
            },
          },
          update: {},
          create: {
            organizationId: orgId,
            category: 'title',
            value: titles[i],
            sortOrder: i,
          },
        }),
      );
    }
    await this.prisma.prisma.$transaction(ops);
  }
}
