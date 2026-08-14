import { Module } from '@nestjs/common';
import { ApprovalController } from './approval.controller';
import { ApprovalService } from './approval.service';

@Module({
  controllers: [ApprovalController],
  providers: [ApprovalService],
})
export class ApprovalModule {}
