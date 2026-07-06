import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ReportsService } from './reports.service';
import { NombaService } from '../nomba/nomba.service';

@ApiTags('Reports')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('estate')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly nomba: NombaService,
  ) {}

  @Get(':id/reports')
  @ApiOperation({ summary: 'Money in vs out, spend by category, collection over time, arrears' })
  async get(@Param('id') id: string) {
    const data = await this.reports.getReports(id);
    return { message: 'OK', data };
  }

  // Kept under /estate/:id for a uniform authed, estate-scoped frontend surface,
  // but the balance itself is the shared Nomba settlement sub-account (app-wide
  // float), so the id is not used to scope it.
  @Get(':id/account-balance')
  @ApiOperation({ summary: 'Live balance of the Nomba settlement sub-account (shared float)' })
  async accountBalance() {
    const data = await this.nomba.fetchSubAccountBalance();
    return { message: 'OK', data };
  }
}
