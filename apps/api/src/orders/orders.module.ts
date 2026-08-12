import { Module } from '@nestjs/common';
import { PatientsModule } from '../patients/patients.module';
import { ResultsModule } from '../results/results.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PatientsModule, ResultsModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
