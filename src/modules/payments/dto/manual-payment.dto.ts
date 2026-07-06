import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class ManualPaymentDto {
  @ApiProperty()
  @IsUUID()
  estateId: string;

  @ApiProperty()
  @IsUUID()
  unitId: string;

  @ApiProperty({ description: 'Amount in naira' })
  @IsNumber()
  @IsPositive()
  amountNaira: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  sender?: string;
}
