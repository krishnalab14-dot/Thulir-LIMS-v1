import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PatientsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
