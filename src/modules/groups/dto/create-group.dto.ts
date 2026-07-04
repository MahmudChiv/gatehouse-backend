import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class CreateGroupDto {
  @ApiProperty({ example: 'Tower West' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name: string;
}
