import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StateService } from './state.service';
import { StateController } from './state.controller';

@Module({
  imports: [PrismaModule],
  providers: [StateService],
  controllers: [StateController],
  exports: [StateService],
})
export class StateModule {}
