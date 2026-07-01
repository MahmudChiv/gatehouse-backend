import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum FeeType {
  SERVICE_FEE = 'service_fee',
  LEVY = 'levy',
}

export enum FeeFrequency {
  MONTHLY = 'monthly',
  QUARTERLY = 'quarterly',
  YEARLY = 'yearly',
  ONE_TIME = 'one_time',
}

export class FeeItemDto {
  @ApiProperty({ example: 'Estate Maintenance Fee', description: 'Fee name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ enum: FeeType, example: FeeType.SERVICE_FEE })
  @IsEnum(FeeType)
  type: FeeType;

  @ApiProperty({ example: 5000, description: 'Amount in Naira' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ enum: FeeFrequency, example: FeeFrequency.MONTHLY })
  @IsEnum(FeeFrequency)
  frequency: FeeFrequency;
}

export class CreateFeeDto {
  @ApiProperty({ description: 'ID of the estate', example: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  estateId: string;

  @ApiProperty({
    type: [FeeItemDto],
    description: 'Array of fees — one service_fee and/or multiple levies',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => FeeItemDto)
  fees: FeeItemDto[];
}
