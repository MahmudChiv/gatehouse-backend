import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class ResolveAccountDto {
  @ApiProperty({ example: '0554772814', description: '10-digit NUBAN' })
  @IsString()
  @Length(10, 10)
  accountNumber: string;

  @ApiProperty({ example: '058', description: 'Bank code from the bank list' })
  @IsString()
  bankCode: string;
}
