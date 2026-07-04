import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';

@ApiTags('Reports')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('estate')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get(':id/reports')
  @ApiOperation({ summary: 'Money in vs out, spend by category, collection over time, arrears' })
  async get(@Param('id') id: string) {
    const data = await this.reports.getReports(id);
    return { message: 'OK', data };
  }
}
