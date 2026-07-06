import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateVendorDto {
  @ApiProperty()
  @IsUUID()
  estateId: string;

  @ApiProperty()
  @IsString()
  name: string;

  @ApiProperty({ example: 'Security' })
  @IsString()
  category: string;

  @ApiProperty({ example: 'GTBank' })
  @IsString()
  bankName: string;

  @ApiProperty({ required: false, example: '058' })
  @IsOptional()
  @IsString()
  bankCode?: string;

  @ApiProperty()
  @IsString()
  accountNumber: string;
}
