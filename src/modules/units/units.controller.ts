import { Body, Controller, Delete, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UnitsService } from './units.service';
import { UpdateUnitDto } from './dto/update-unit.dto';

@ApiTags('Units')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('estate/:estateId')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Patch('units/:unitId')
  @ApiOperation({ summary: 'Update a unit’s resident contact info (email / phone)' })
  async update(
    @Param('estateId') estateId: string,
    @Param('unitId') unitId: string,
    @Body() dto: UpdateUnitDto,
  ) {
    const data = await this.units.updateContact(estateId, unitId, { email: dto.email, phone: dto.phone });
    return { message: 'Unit updated', data };
  }

  @Delete('units/:unitId')
  @ApiOperation({ summary: 'Remove a unit (soft delete)' })
  async remove(@Param('estateId') estateId: string, @Param('unitId') unitId: string) {
    const data = await this.units.softDelete(estateId, unitId);
    return { message: 'Unit removed', data };
  }
}
