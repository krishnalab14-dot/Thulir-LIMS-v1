import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { CheckDuplicateQueryDto } from './dto/check-duplicate-query.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { PatientsService } from './patients.service';

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @Get('check-duplicate')
  checkDuplicate(@Query() query: CheckDuplicateQueryDto) {
    return this.patients.checkDuplicate(query);
  }

  @Post()
  create(@Body() dto: CreatePatientDto) {
    return this.patients.create(dto);
  }
}
