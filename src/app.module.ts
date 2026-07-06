import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { OnboardingModule } from './modules/onboarding/onboarding.module';
import { NombaModule } from './modules/nomba/nomba.module';
import { HealthModule } from './modules/health/health.module';
import { ReconciliationModule } from './modules/reconciliation/reconciliation.module';
import { NotifierModule } from './modules/notifier/notifier.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { WebhookModule } from './modules/webhook/webhook.module';
import { BillingModule } from './modules/billing/billing.module';
import { ExceptionsModule } from './modules/exceptions/exceptions.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { StateModule } from './modules/state/state.module';
import { GroupsModule } from './modules/groups/groups.module';
import { UnitsModule } from './modules/units/units.module';
import { PublicModule } from './modules/public/public.module';
import { ReportsModule } from './modules/reports/reports.module';

@Module({
  imports: [
    // Global config — loads .env
    ConfigModule.forRoot({ isGlobal: true }),

    // Schedule module for token refresh cron
    ScheduleModule.forRoot(),

    // Core modules
    PrismaModule,
    NombaModule,
    ReconciliationModule,
    NotifierModule,
    RealtimeModule,

    // Feature modules
    AuthModule,
    OnboardingModule,
    HealthModule,
    PaymentsModule,
    WebhookModule,
    BillingModule,
    ExceptionsModule,
    PayoutsModule,
    StateModule,
    GroupsModule,
    UnitsModule,
    PublicModule,
    ReportsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
