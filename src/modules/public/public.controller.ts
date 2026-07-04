import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PublicService } from './public.service';

// No auth — tokenised resident statement (PRD §5.6).
@ApiTags('Public')
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Resident statement by link token (or unit id)' })
  async statement(@Param('token') token: string) {
    const data = await this.publicService.getPublicStatement(token);
    return { message: data ? 'OK' : 'Statement not found', data };
  }
}
