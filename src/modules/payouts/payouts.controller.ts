import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PayoutsService } from './payouts.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { PayVendorDto } from './dto/pay-vendor.dto';
import { nairaToKobo } from '../../common/money';

@ApiTags('Vendors & Payouts')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller()
export class PayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Post('vendors')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Add a vendor' })
  async addVendor(@Body() dto: CreateVendorDto) {
    const { estateId, ...vendor } = dto;
    const data = await this.payouts.addVendor(estateId, vendor);
    return { message: 'Vendor added', data };
  }

  @Post('payouts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Pay a vendor via Nomba transfer' })
  async pay(@Body() dto: PayVendorDto) {
    const data = await this.payouts.payVendor(dto.estateId, dto.vendorId, nairaToKobo(dto.amountNaira), dto.note);
    return { message: 'Payout initiated', data };
  }
}
