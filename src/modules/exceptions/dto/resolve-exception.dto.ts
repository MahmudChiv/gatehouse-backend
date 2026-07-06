import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID } from 'class-validator';

const ACTIONS = ['credit', 'refund', 'duplicate-hold', 'duplicate-keep', 'reassign', 'attribute', 'acknowledge'] as const;

export class ResolveExceptionDto {
  @ApiProperty({ enum: ACTIONS })
  @IsIn(ACTIONS as unknown as string[])
  action: (typeof ACTIONS)[number];

  @ApiProperty({ required: false, description: 'Target unit for a misdirected reassignment' })
  @IsOptional()
  @IsUUID()
  @IsString()
  targetUnitId?: string;
}
