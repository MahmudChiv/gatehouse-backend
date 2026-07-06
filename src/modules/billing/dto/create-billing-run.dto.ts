import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class CreateBillingRunDto {
  @ApiProperty()
  @IsUUID()
  estateId: string;

  @ApiProperty({ example: 'Q4 2026' })
  @IsString()
  cycleLabel: string;

  @ApiProperty({ description: 'Charge amount in naira', example: 45000 })
  @IsNumber()
  @IsPositive()
  chargeAmountNaira: number;

  @ApiProperty({ description: 'Due date as epoch milliseconds' })
  @IsNumber()
  dueDate: number;

  @ApiProperty({ required: false, description: 'Omit to bill all units', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  unitIds?: string[];
}
