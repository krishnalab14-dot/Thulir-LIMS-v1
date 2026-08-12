import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { RejectSampleDto } from './dto/reject-sample.dto';
import { SamplesService } from './samples.service';

@Controller('samples')
export class SamplesController {
  constructor(private readonly samples: SamplesService) {}

  @Get('pending')
  pending() {
    return this.samples.listPending();
  }

  @Put(':id/collect')
  collect(@Param('id') id: string) {
    return this.samples.collect(id);
  }

  @Put(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectSampleDto) {
    return this.samples.reject(id, dto);
  }

  @Get(':id/label')
  label(@Param('id') id: string) {
    return this.samples.getLabel(id);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.samples.getDetail(id);
  }
}
