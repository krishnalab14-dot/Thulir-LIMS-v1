import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { PartyType, Role } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { Roles } from '../auth/roles.decorator';
import { GeneratePortalAccessDto } from '../portal/dto/portal-access.dto';
import { CreatePartyDto } from './dto/create-party.dto';
import { PartiesService } from './parties.service';

export class SearchPartiesQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  @IsOptional()
  @IsIn(Object.values(PartyType))
  type?: PartyType;
}

@Controller('parties')
export class PartiesController {
  constructor(private readonly parties: PartiesService) {}

  @Get('search')
  search(@Query() query: SearchPartiesQueryDto) {
    return this.parties.search(query.q, query.type);
  }

  /** GET /api/parties?all=true&type=doctor — list all (including inactive) for admin management. */
  @Get()
  listAll(@Query('type') type?: PartyType, @Query('all') all?: string) {
    if (all === 'true') return this.parties.listAll(type);
    return this.parties.search(undefined, type);
  }

  @Post()
  create(@Body() dto: CreatePartyDto) {
    return this.parties.create(dto);
  }

  /** PATCH /api/parties/:id { name?, active? } — update name or toggle active. */
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; active?: boolean }) {
    return this.parties.update(id, body);
  }

  /**
   * POST /api/parties/:id/portal-access — admin/lab_manager only. Generates
   * or resets a referrer's portal credentials. The plaintext password is
   * returned ONCE (§2: "copy this now, it won't be shown again").
   */
  @Roles(Role.admin, Role.lab_manager)
  @Put(':id/portal-access')
  @HttpCode(201)
  generatePortalAccess(
    @Param('id') id: string,
    @Body() dto: GeneratePortalAccessDto,
  ) {
    return this.parties.generatePortalAccess(id, dto);
  }
}
