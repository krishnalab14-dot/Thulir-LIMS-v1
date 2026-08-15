import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { ApprovalService } from './approval.service';
import { ApproveOrderDto, RejectBackToVerifyDto } from './dto/approval-order.dto';

/**
 * Stage 5 Approval — per-test granularity (OrderTest.status is the unit of
 * approval, matching every stage since Stage 1). The queue is a top-level
 * route; the approve-review/approve/reject routes live under /orders/:id like
 * the Stage 3 results and Stage 4 verify routes.
 *
 * Role gate (Stage 7, now ENFORCED — the pre-auth "documented but not
 * enforced" note below is obsolete): the pathologist's final gate —
 * pathologist/admin/lab_manager only, exactly the roles documented in the
 * stage spec. Every other role gets a 403.
 */
@Roles(Role.pathologist, Role.admin, Role.lab_manager)
@Controller()
export class ApprovalController {
  constructor(private readonly approvalService: ApprovalService) {}

  @Get('approval-queue')
  getApprovalQueue() {
    return this.approvalService.getApprovalQueue();
  }

  @Get('orders/:id/approve-review')
  getApproveReview(@Param('id') id: string) {
    return this.approvalService.getApproveReview(id);
  }

  @Put('orders/:id/approve')
  approve(@Param('id') id: string, @Body() dto: ApproveOrderDto) {
    return this.approvalService.approve(id, dto);
  }

  @Put('orders/:id/reject-back-to-verify')
  rejectBackToVerify(@Param('id') id: string, @Body() dto: RejectBackToVerifyDto) {
    return this.approvalService.rejectBackToVerify(id, dto);
  }
}
