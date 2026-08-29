import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { UpdateOrgSettingsDto } from './dto/update-org-settings.dto';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * GET /api/settings/organization — returns current org letterhead details.
   * Any authenticated staff can read (needed for Report/Invoice rendering).
   */
  async getOrgSettings() {
    const orgId = this.tenant.requireOrganizationId();
    const org = await this.prisma.prisma.organization.findUniqueOrThrow({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        email: true,
        nablAccreditationNumber: true,
        gstNumber: true,
        logoUrl: true,
      },
    });
    return org;
  }

  /**
   * PUT /api/settings/organization — update org letterhead details.
   * Admin / lab_manager only (role-gated by @Roles decorator on controller).
   * Uses upsert on the org row so it works even if fields were previously null.
   */
  async updateOrgSettings(dto: UpdateOrgSettingsDto) {
    const orgId = this.tenant.requireOrganizationId();
    const clear = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
    const data: Record<string, string | null> = {};
    if (dto.address !== undefined) data.address = clear(dto.address);
    if (dto.phone !== undefined) data.phone = clear(dto.phone);
    if (dto.email !== undefined) data.email = clear(dto.email);
    if (dto.nablAccreditationNumber !== undefined) data.nablAccreditationNumber = clear(dto.nablAccreditationNumber);
    if (dto.gstNumber !== undefined) data.gstNumber = clear(dto.gstNumber);
    if (dto.logoUrl !== undefined) data.logoUrl = clear(dto.logoUrl);

    if (Object.keys(data).length === 0) return this.getOrgSettings();

    const org = await this.prisma.prisma.organization.update({
      where: { id: orgId },
      data,
      select: {
        id: true,
        name: true,
        address: true,
        phone: true,
        email: true,
        nablAccreditationNumber: true,
        gstNumber: true,
        logoUrl: true,
      },
    });
    return org;
  }
}
