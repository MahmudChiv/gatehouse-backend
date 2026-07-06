import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StateModule } from '../state/state.module';
import { PublicService } from './public.service';
import { PublicController } from './public.controller';

@Module({
  imports: [PrismaModule, StateModule],
  providers: [PublicService],
  controllers: [PublicController],
})
export class PublicModule {}
