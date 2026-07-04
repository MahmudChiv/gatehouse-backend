import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsString, IsUUID } from 'class-validator';

export class SimulatePaymentDto {
  @ApiProperty()
  @IsUUID()
  estateId: string;

  @ApiProperty({ description: 'Unit label, e.g. A1. Unknown label → unmatched flow.' })
  @IsString()
  unitLabel: string;

  @ApiProperty({ description: 'Amount in naira' })
  @IsNumber()
  @IsPositive()
  amountNaira: number;
}
