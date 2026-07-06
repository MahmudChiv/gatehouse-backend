import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsOptional, IsPositive, IsString, IsUUID } from 'class-validator';

export class CreateLevyDto {
  @ApiProperty()
  @IsUUID()
  estateId: string;

  @ApiProperty({ example: 'Generator repair levy' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'Amount in naira per unit', example: 10000 })
  @IsNumber()
  @IsPositive()
  amountNaira: number;

  @ApiProperty({ description: 'Due date as epoch milliseconds' })
  @IsNumber()
  dueDate: number;

  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  requireExact?: boolean;

  @ApiProperty({ required: false, description: 'Omit to bill all units', type: [String] })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  unitIds?: string[];
}
