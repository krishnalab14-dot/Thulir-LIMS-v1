import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApprovalService } from './approval.service';
import { ApproveOrderDto, RejectBackToVerifyDto } from './dto/approval-order.dto';

/**
 * Stage 5 Approval — per-test granularity (OrderTest.status is the unit of
 * approval, matching every stage since Stage 1). The queue is a top-level
 * route; the approve-review/approve/reject routes live under /orders/:id like
 * the Stage 3 results and Stage 4 verify routes.
 *
 * NOTE: role gating (pathologist/admin/manager) is documented in the stage
 * spec but cannot be ENFORCED yet — the app has no auth middleware (all
 * user-scoped columns are stamped with SYSTEM_USER_ID until the auth stage
 * lands, the established pattern since Stage 1). The endpoint-level role gate
 * arrives with auth; the tenant scoping here is already fail-closed.
 */
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
