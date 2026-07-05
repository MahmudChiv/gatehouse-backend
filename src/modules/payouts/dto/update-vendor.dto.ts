import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID } from 'class-validator';

export class UpdateVendorDto {
  @ApiProperty()
  @IsUUID()
  estateId: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ required: false, example: 'Security' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiProperty({ required: false, example: 'GTBank' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiProperty({ required: false, example: '058' })
  @IsOptional()
  @IsString()
  bankCode?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  accountNumber?: string;
}
