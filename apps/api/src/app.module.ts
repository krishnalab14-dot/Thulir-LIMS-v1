import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { InvoicesModule } from './invoices/invoices.module';
import { MastersModule } from './masters/masters.module';
import { OrdersModule } from './orders/orders.module';
import { PartiesModule } from './parties/parties.module';
import { PatientsModule } from './patients/patients.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantMiddleware } from './prisma/tenant.middleware';
import { SamplesModule } from './samples/samples.module';
import { SupabaseModule } from './supabase/supabase.module';
import { VerifyModule } from './verify/verify.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    PrismaModule,
    PatientsModule,
    MastersModule,
    PartiesModule,
    OrdersModule,
    InvoicesModule,
    SamplesModule,
    VerifyModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // '*path' is the path-to-regexp v8 (Express 5) named wildcard — matches every route.
    consumer.apply(TenantMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
