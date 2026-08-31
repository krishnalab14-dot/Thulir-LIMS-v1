import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { CreatePackageDto } from './dto/create-package.dto';
import { CreateSampleTypeDto } from './dto/create-sample-type.dto';
import { CreateTestDto } from './dto/create-test.dto';
import { UpdateTestDto } from './dto/update-test.dto';
import { MastersService } from './masters.service';

/**
 * Masters — the test catalog is the pricing/resulting authority for every
 * order in the org, so editing it is admin-only (Stage 7 now enforces what
 * earlier stages documented as admin territory). Reads are open to every
 * authenticated user (orders/result entry need the catalog).
 */
@Controller('masters')
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get('tests/search')
  searchTests(@Query('q') q?: string) {
    return this.masters.searchTests(q);
  }

  @Get('tests')
  listTests() {
    return this.masters.listTests();
  }

  @Roles(Role.admin)
  @Post('tests')
  createTest(@Body() dto: CreateTestDto) {
    return this.masters.createTest(dto);
  }

  @Roles(Role.admin)
  @Patch('tests/:id')
  updateTest(@Param('id') id: string, @Body() dto: UpdateTestDto) {
    return this.masters.updateTest(id, dto);
  }

  @Roles(Role.admin)
  @Delete('tests/:id')
  deactivateTest(@Param('id') id: string) {
    return this.masters.deactivateTest(id);
  }

  @Get('packages/search')
  searchPackages(@Query('q') q?: string) {
    return this.masters.searchPackages(q);
  }

  @Roles(Role.admin)
  @Post('packages')
  createPackage(@Body() dto: CreatePackageDto) {
    return this.masters.createPackage(dto);
  }

  @Get('sample-types')
  listSampleTypes() {
    return this.masters.listSampleTypes();
  }

  @Roles(Role.admin)
  @Post('sample-types')
  createSampleType(@Body() dto: CreateSampleTypeDto) {
    return this.masters.createSampleType(dto);
  }
}
