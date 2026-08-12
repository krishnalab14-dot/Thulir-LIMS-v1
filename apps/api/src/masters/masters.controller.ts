import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CreatePackageDto } from './dto/create-package.dto';
import { CreateSampleTypeDto } from './dto/create-sample-type.dto';
import { CreateTestDto } from './dto/create-test.dto';
import { MastersService } from './masters.service';

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

  @Post('tests')
  createTest(@Body() dto: CreateTestDto) {
    return this.masters.createTest(dto);
  }

  @Get('packages/search')
  searchPackages(@Query('q') q?: string) {
    return this.masters.searchPackages(q);
  }

  @Post('packages')
  createPackage(@Body() dto: CreatePackageDto) {
    return this.masters.createPackage(dto);
  }

  @Get('sample-types')
  listSampleTypes() {
    return this.masters.listSampleTypes();
  }

  @Post('sample-types')
  createSampleType(@Body() dto: CreateSampleTypeDto) {
    return this.masters.createSampleType(dto);
  }
}
