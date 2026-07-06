import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString } from 'class-validator';

// Only the resident contact fields are editable here — the virtual account is
// immutable, so accountNumber is deliberately absent. Both fields are optional so
// a manager can update just one; email can be changed but not cleared (schema
// requires it), phone can be cleared by sending an empty string.
export class UpdateUnitDto {
  @ApiPropertyOptional({ description: 'Resident email address' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ description: 'Resident phone number (empty string clears it)' })
  @IsOptional()
  @IsString()
  phone?: string;
}
