import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PayoutsService } from './payouts.service';
import { CreateVendorDto } from './dto/create-vendor.dto';
import { UpdateVendorDto } from './dto/update-vendor.dto';
import { PayVendorDto } from './dto/pay-vendor.dto';
import { ResolveAccountDto } from './dto/resolve-account.dto';
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

  @Patch('vendors/:vendorId')
  @ApiOperation({ summary: 'Edit a vendor' })
  async updateVendor(@Param('vendorId') vendorId: string, @Body() dto: UpdateVendorDto) {
    const { estateId, ...patch } = dto;
    const data = await this.payouts.updateVendor(estateId, vendorId, patch);
    return { message: 'Vendor updated', data };
  }

  @Delete('vendors/:vendorId')
  @ApiOperation({ summary: 'Remove a vendor (soft delete)' })
  async removeVendor(@Param('vendorId') vendorId: string, @Query('estateId') estateId: string) {
    const data = await this.payouts.deleteVendor(estateId, vendorId);
    return { message: 'Vendor removed', data };
  }

  @Get('vendors/banks')
  @ApiOperation({ summary: 'List banks (with codes) for adding or paying a vendor' })
  async banks() {
    const data = await this.payouts.listBanks();
    return { message: 'Banks', data };
  }

  @Post('vendors/resolve-account')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve the account-holder name for a bank account' })
  async resolveAccount(@Body() dto: ResolveAccountDto) {
    const data = await this.payouts.resolveAccountName(dto.accountNumber, dto.bankCode);
    return { message: 'Account resolved', data };
  }

  @Post('payouts')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Pay a vendor via Nomba transfer' })
  async pay(@Body() dto: PayVendorDto) {
    const data = await this.payouts.payVendor(dto.estateId, dto.vendorId, nairaToKobo(dto.amountNaira), dto.note);
    return { message: 'Payout initiated', data };
  }
}
