import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'Aisha Bello', description: 'Full name of the estate manager' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'aisha.bello@estateco.ng', description: 'Work email address' })
  @IsEmail({}, { message: 'Please provide a valid email address' })
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: '+2348012345678', description: 'Phone number (optional)' })
  @IsString()
  @IsOptional()
  phone?: string;

  @ApiProperty({
    example: 'P@ssw0rd#2024',
    description:
      'Strong password: min 8 chars, at least one uppercase, one lowercase, one number, one special character',
  })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters' })
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&\#^()\-_=+{};:,<.>])[A-Za-z\d@$!%*?&\#^()\-_=+{};:,<.>]{8,}$/, {
    message:
      'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
  })
  password: string;
}
