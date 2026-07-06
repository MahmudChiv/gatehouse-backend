import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { StateService } from './state.service';
import { UpdateEstateDto } from './dto/update-estate.dto';
import { nairaToKobo } from '../../common/money';

@ApiTags('State')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('estate')
export class StateController {
  constructor(private readonly state: StateService) {}

  @Get(':id/state')
  @ApiOperation({ summary: 'Full estate view-model (dashboard, units, payments, exceptions, etc.)' })
  async getState(@Param('id') id: string) {
    const data = await this.state.getEstateState(id);
    return { message: 'OK', data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update estate details / allocation rule / auto-credit threshold' })
  async update(@Param('id') id: string, @Body() dto: UpdateEstateDto) {
    const data = await this.state.updateEstate(id, {
      name: dto.name,
      address: dto.address,
      city: dto.city,
      cycleLabel: dto.cycleLabel,
      allocationRule: dto.allocationRule,
      autoCreditThresholdKobo: dto.autoCreditThresholdNaira != null ? nairaToKobo(dto.autoCreditThresholdNaira) : undefined,
    });
    return { message: 'Estate updated', data };
  }
}
