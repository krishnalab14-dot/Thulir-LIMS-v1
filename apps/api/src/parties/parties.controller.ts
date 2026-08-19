import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
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

  @Post()
  create(@Body() dto: CreatePartyDto) {
    return this.parties.create(dto);
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
