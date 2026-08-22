import { Module } from '@nestjs/common';
import { LookupItemsController } from './lookup-items.controller';
import { LookupItemsService } from './lookup-items.service';

@Module({
  controllers: [LookupItemsController],
  providers: [LookupItemsService],
})
export class LookupItemsModule {}
