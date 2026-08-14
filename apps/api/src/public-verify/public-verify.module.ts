import { Module } from '@nestjs/common';
import { PublicVerifyController } from './public-verify.controller';
import { PublicVerifyService } from './public-verify.service';

@Module({
  controllers: [PublicVerifyController],
  providers: [PublicVerifyService],
})
export class PublicVerifyModule {}
