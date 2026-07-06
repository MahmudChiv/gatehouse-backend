import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { NombaModule } from '../nomba/nomba.module';
import { PaymentsModule } from '../payments/payments.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { WebhookController } from './webhook.controller';

@Module({
  imports: [PrismaModule, NombaModule, PaymentsModule, RealtimeModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
