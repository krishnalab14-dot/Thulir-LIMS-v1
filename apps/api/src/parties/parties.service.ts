import { Injectable } from '@nestjs/common';
import { PartyType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { CreatePartyDto } from './dto/create-party.dto';

@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /** Typeahead for the referring-doctor field (filter type=doctor from the UI). */
  async search(q?: string, type?: PartyType) {
    const term = (q ?? '').trim();
    return this.prisma.prisma.party.findMany({
      where: {
        active: true,
        ...(type ? { type } : {}),
        ...(term ? { OR: [{ name: { contains: term, mode: 'insensitive' } }] } : {}),
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
  }

  async create(dto: CreatePartyDto) {
    const orgId = this.tenant.requireOrganizationId();
    return this.prisma.prisma.party.create({ data: { organizationId: orgId, name: dto.name.trim(), type: dto.type } });
  }
}
