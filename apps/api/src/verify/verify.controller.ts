import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RejectBackDto, VerifyOrderDto } from './dto/verify-order.dto';
import { VerifyService } from './verify.service';

/**
 * Stage 4 Verification — per-test granularity (OrderTest.status is the unit
 * of verification). The queue is a top-level route; the review/verify/reject
 * routes live under /orders/:id like the Stage 3 results routes.
 *
 * Role gate (Stage 7): the senior-technician "second pair of eyes" screen —
 * technician/admin/lab_manager only, matching the role documented since
 * Stage 4. Every other authenticated role gets a 403.
 */
@Roles(Role.technician, Role.admin, Role.lab_manager)
@Controller()
export class VerifyController {
  constructor(private readonly verifyService: VerifyService) {}

  @Get('verify-queue')
  getVerifyQueue() {
    return this.verifyService.getVerifyQueue();
  }

  @Get('orders/:id/review')
  getReview(@Param('id') id: string) {
    return this.verifyService.getReview(id);
  }

  @Put('orders/:id/verify')
  verify(@Param('id') id: string, @Body() dto: VerifyOrderDto) {
    return this.verifyService.verify(id, dto);
  }

  @Put('orders/:id/reject-back-to-entry')
  rejectBack(@Param('id') id: string, @Body() dto: RejectBackDto) {
    return this.verifyService.rejectBack(id, dto);
  }
}
