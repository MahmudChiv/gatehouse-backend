import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { BillingService } from './billing.service';
import { CreateBillingRunDto } from './dto/create-billing-run.dto';
import { CreateLevyDto } from './dto/create-levy.dto';
import { nairaToKobo } from '../../common/money';

@ApiTags('Billing')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('run')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a billing run (one service charge per unit)' })
  async run(@Body() dto: CreateBillingRunDto) {
    const data = await this.billing.createBillingRun(dto.estateId, {
      cycleLabel: dto.cycleLabel,
      chargeAmountKobo: nairaToKobo(dto.chargeAmountNaira),
      dueDate: dto.dueDate,
      unitIds: dto.unitIds,
    });
    return { message: 'Billing run created', data };
  }

  @Post('levy')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a one-off levy charge per unit' })
  async levy(@Body() dto: CreateLevyDto) {
    const data = await this.billing.createLevy(dto.estateId, {
      name: dto.name,
      amountKobo: nairaToKobo(dto.amountNaira),
      dueDate: dto.dueDate,
      requireExact: dto.requireExact,
      unitIds: dto.unitIds,
    });
    return { message: 'Levy created', data };
  }
}
