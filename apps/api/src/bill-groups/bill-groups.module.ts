import { Module } from '@nestjs/common';
import { BillGroupsController } from './bill-groups.controller';
import { BillGroupsService } from './bill-groups.service';

@Module({
  controllers: [BillGroupsController],
  providers: [BillGroupsService],
})
export class BillGroupsModule {}
