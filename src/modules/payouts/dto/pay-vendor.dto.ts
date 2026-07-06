import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsString, IsUUID } from 'class-validator';

export class PayVendorDto {
  @ApiProperty()
  @IsUUID()
  estateId: string;

  @ApiProperty()
  @IsUUID()
  vendorId: string;

  @ApiProperty({ description: 'Amount in naira' })
  @IsNumber()
  @IsPositive()
  amountNaira: number;

  @ApiProperty({ example: 'August security' })
  @IsString()
  note: string;
}
