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

@Module({
  imports: [
    // Global config — loads .env
    ConfigModule.forRoot({ isGlobal: true }),

    // Schedule module for token refresh cron
    ScheduleModule.forRoot(),

    // Core modules
    PrismaModule,
    NombaModule,

    // Feature modules
    AuthModule,
    OnboardingModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
