import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class CreateEstateDto {
  @ApiProperty({ example: 'Greenvale Estate', description: 'Name of the estate' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '12 Palm Avenue, Lekki', description: 'Full street address' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({ example: 'Lagos', description: 'City where estate is located' })
  @IsString()
  @IsNotEmpty()
  city: string;

  @ApiProperty({ example: 'Lagos', description: 'State where estate is located' })
  @IsString()
  @IsNotEmpty()
  state: string;

  @ApiProperty({ example: 120, description: 'Total number of units in the estate' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  units: number;
}
