import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsString } from 'class-validator';
import { AllocationRule } from '@prisma/client';

export class UpdateEstateDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  cycleLabel?: string;

  @ApiProperty({ required: false, enum: AllocationRule })
  @IsOptional()
  @IsEnum(AllocationRule)
  allocationRule?: AllocationRule;

  @ApiProperty({ required: false, description: 'Auto-credit threshold in naira' })
  @IsOptional()
  @IsNumber()
  autoCreditThresholdNaira?: number;
}
