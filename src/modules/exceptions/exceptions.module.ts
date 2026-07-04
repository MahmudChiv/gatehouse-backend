import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReconciliationModule } from '../reconciliation/reconciliation.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { ExceptionsService } from './exceptions.service';
import { ExceptionsController } from './exceptions.controller';

@Module({
  imports: [PrismaModule, ReconciliationModule, RealtimeModule],
  providers: [ExceptionsService],
  controllers: [ExceptionsController],
  exports: [ExceptionsService],
})
export class ExceptionsModule {}
