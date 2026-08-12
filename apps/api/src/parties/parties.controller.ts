import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { PartyType } from '@prisma/client';
import { IsIn, IsOptional, IsString } from 'class-validator';
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
}
