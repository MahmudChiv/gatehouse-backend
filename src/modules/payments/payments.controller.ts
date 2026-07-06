import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaymentsService } from './payments.service';
import { ManualPaymentDto } from './dto/manual-payment.dto';
import { SimulatePaymentDto } from './dto/simulate-payment.dto';

@ApiTags('Payments')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('manual')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Record a manual/cash payment (runs the reconciliation engine)' })
  async manual(@Body() dto: ManualPaymentDto) {
    const result = await this.payments.recordManualPayment(dto.estateId, dto.unitId, dto.amountNaira, dto.sender);
    return { message: 'Payment recorded', data: result };
  }

  @Post('simulate')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Dev: simulate an inbound transfer through the same webhook→reconciliation path' })
  async simulate(@Body() dto: SimulatePaymentDto) {
    const result = await this.payments.simulatePayment(dto.estateId, dto.unitLabel, dto.amountNaira);
    return { message: 'Payment simulated', data: result };
  }
}
