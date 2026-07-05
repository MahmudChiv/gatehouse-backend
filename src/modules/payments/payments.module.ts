import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotifierModule } from '../notifier/notifier.module';
import { NombaModule } from '../nomba/nomba.module';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [PrismaModule, ReconciliationModule, RealtimeModule, NotifierModule, NombaModule],
  providers: [PaymentsService],
  controllers: [PaymentsController],
  exports: [PaymentsService],
})
export class PaymentsModule {}
