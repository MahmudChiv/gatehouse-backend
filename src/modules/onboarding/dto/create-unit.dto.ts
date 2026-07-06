import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OccupantType {
  OWNER = 'owner',
  TENANT = 'tenant',
}

export class UnitItemDto {
  @ApiProperty({ example: 'A', description: 'Block identifier' })
  @IsString()
  @IsNotEmpty()
  block: string;

  @ApiProperty({ example: 'A1', description: 'Unit label (unique within block)' })
  @IsString()
  @IsNotEmpty()
  unitName: string;

  @ApiProperty({ example: 'Chukwuemeka Obi', description: 'Occupant full name' })
  @IsString()
  @IsNotEmpty()
  occupant: string;

  @ApiPropertyOptional({ example: '08012345678', description: 'Occupant phone number' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({ example: 'emeka.obi@gmail.com', description: 'Occupant contact email for billing notifications' })
  @IsEmail({}, { message: 'Provide a valid email for occupant' })
  email: string;

  @ApiProperty({ enum: OccupantType, example: OccupantType.OWNER })
  @IsEnum(OccupantType)
  type: OccupantType;
}

export class CreateUnitDto {
  @ApiProperty({ description: 'Estate ID', example: 'uuid' })
  @IsUUID()
  @IsNotEmpty()
  estateId: string;

  @ApiPropertyOptional({
    type: [UnitItemDto],
    description: 'Array of units (use this OR upload a CSV file)',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UnitItemDto)
  @IsOptional()
  units?: UnitItemDto[];
}
