import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AlertsModule } from './alerts/alerts.module';
import { ApprovalModule } from './approval/approval.module';
import { AuthModule } from './auth/auth.module';
import { BillGroupsModule } from './bill-groups/bill-groups.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';
import { InvoicesModule } from './invoices/invoices.module';
import { LookupItemsModule } from './lookup-items/lookup-items.module';
import { MastersModule } from './masters/masters.module';
import { OrdersModule } from './orders/orders.module';
import { PartiesModule } from './parties/parties.module';
import { PatientsModule } from './patients/patients.module';
import { PortalModule } from './portal/portal.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantMiddleware } from './prisma/tenant.middleware';
import { PublicVerifyModule } from './public-verify/public-verify.module';
import { ReportsModule } from './reports/reports.module';
import { SamplesModule } from './samples/samples.module';
import { SettingsModule } from './settings/settings.module';
import { SupabaseModule } from './supabase/supabase.module';
import { VerifyModule } from './verify/verify.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    SupabaseModule,
    PrismaModule,
    // Stage 7 real auth — JwtModule is global (middleware needs JwtService), and
    // the two guards below are registered GLOBAL (APP_GUARD): every route
    // requires a valid access token unless marked @Public(), and every route
    // carrying @Roles(...) is enforced with a 403 for other roles.
    AuthModule,
    PatientsModule,
    MastersModule,
    PartiesModule,
    OrdersModule,
    InvoicesModule,
    BillGroupsModule,
    LookupItemsModule,
    SamplesModule,
    VerifyModule,
    ApprovalModule,
    ReportsModule,
    SettingsModule,
    PublicVerifyModule,
    // Stage 8: patient/referrer self-service portals. Portal auth tokens
    // (type: 'patient' | 'referrer') are rejected by the global JwtAuthGuard
    // (cross-boundary protection) and accepted only by PortalJwtAuthGuard.
    PortalModule,
    // Stage 9: critical-value alerting (in-app acknowledgment).
    AlertsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // '*path' is the path-to-regexp v8 (Express 5) named wildcard — matches every route.
    consumer.apply(TenantMiddleware).forRoutes({ path: '*path', method: RequestMethod.ALL });
  }
}
