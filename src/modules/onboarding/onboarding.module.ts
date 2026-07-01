import { Module } from '@nestjs/common';
import { OnboardingService } from './onboarding.service';
import { OnboardingController } from './onboarding.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { NombaModule } from '../nomba/nomba.module';

@Module({
  imports: [PrismaModule, NombaModule],
  providers: [OnboardingService],
  controllers: [OnboardingController],
})
export class OnboardingModule {}
