import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsUUID, ValidateIf } from 'class-validator';

export class AssignGroupDto {
  // null (or omitted) moves the unit back to ungrouped; a UUID assigns it.
  @ApiProperty({ required: false, nullable: true, description: 'Target group id, or null to ungroup' })
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  groupId?: string | null;
}
