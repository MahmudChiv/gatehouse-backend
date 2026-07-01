import { Module } from '@nestjs/common';
import { NombaService } from './nomba.service';

@Module({
  providers: [NombaService],
  exports: [NombaService],
})
export class NombaModule {}
