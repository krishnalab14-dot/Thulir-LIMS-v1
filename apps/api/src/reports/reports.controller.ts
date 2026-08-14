import { Controller, Get, Param } from '@nestjs/common';
import { ReportsService } from './reports.service';

/**
 * Stage 6 Report — the final stage of the base workflow pipeline. The report
 * is only reachable for fully-approved orders (server-side 409 gate), and is
 * the source of truth for the public verification QR.
 */
@Controller()
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('orders/:id/report')
  getReport(@Param('id') id: string) {
    return this.reportsService.getReport(id);
  }
}
