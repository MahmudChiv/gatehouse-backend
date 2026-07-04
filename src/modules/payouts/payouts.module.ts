import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NombaModule } from '../nomba/nomba.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { PayoutsService } from './payouts.service';
import { PayoutsController } from './payouts.controller';

@Module({
  imports: [PrismaModule, NombaModule, RealtimeModule],
  providers: [PayoutsService],
  controllers: [PayoutsController],
  exports: [PayoutsService],
})
export class PayoutsModule {}
