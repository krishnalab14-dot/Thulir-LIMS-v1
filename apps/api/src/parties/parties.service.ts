import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PartyType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { CreatePartyDto } from './dto/create-party.dto';
import { GeneratePortalAccessDto } from '../portal/dto/portal-access.dto';

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

  /** List ALL parties of a type (including inactive) for admin management. */
  async listAll(type?: PartyType) {
    const orgId = this.tenant.requireOrganizationId();
    return this.prisma.prisma.party.findMany({
      where: { organizationId: orgId, ...(type ? { type } : {}) },
      orderBy: { name: 'asc' },
    });
  }

  /** Update name and/or active status. */
  async update(id: string, data: { name?: string; active?: boolean }) {
    const orgId = this.tenant.requireOrganizationId();
    const party = await this.prisma.prisma.party.findFirst({ where: { id, organizationId: orgId } });
    if (!party) throw new NotFoundException('Party not found');
    return this.prisma.prisma.party.update({
      where: { id },
      data: {
        ...(data.name !== undefined ? { name: data.name.trim() } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
    });
  }

  /**
   * POST /api/parties/:id/portal-access — admin/lab_manager generates or
   * resets a referrer's portal credentials. Returns the new username and
   * plaintext password ONCE (§2: "copy this now, it won't be shown again").
   * The password is bcrypt-hashed before storage; there is NO endpoint to
   * retrieve an existing password — only reset.
   */
  async generatePortalAccess(partyId: string, dto: GeneratePortalAccessDto) {
    const orgId = this.tenant.requireOrganizationId();

    const party = await this.prisma.prisma.party.findUnique({ where: { id: partyId } });
    if (!party) {
      throw new NotFoundException('Party not found');
    }
    if (party.organizationId !== orgId) {
      throw new NotFoundException('Party not found'); // fail-closed, no cross-tenant leak
    }

    // Generate or use the provided username.
    const username = dto.username?.trim() ?? `ref_${party.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 16)}_${Date.now().toString(36)}`;

    // Check uniqueness (globally — same as staff User.username).
    const existing = await this.prisma.raw.party.findFirst({ where: { portalUsername: username } });
    if (existing && existing.id !== partyId) {
      throw new ConflictException('Username is already taken');
    }

    // Generate a random plaintext password; hash it for storage.
    const plaintext = `Ref${randomBytes(12).toString('base64url')}!`;
    const passwordHash = await bcrypt.hash(plaintext, 10);

    await this.prisma.prisma.party.update({
      where: { id: partyId },
      data: { portalUsername: username, portalPasswordHash: passwordHash },
    });

    return {
      partyId,
      portalUsername: username,
      plaintext, // returned ONCE, never stored in plaintext
    };
  }
}
