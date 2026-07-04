import { Body, Controller, HttpCode, HttpStatus, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ExceptionsService } from './exceptions.service';
import { ResolveExceptionDto } from './dto/resolve-exception.dto';

@ApiTags('Exceptions')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('exceptions')
export class ExceptionsController {
  constructor(private readonly exceptions: ExceptionsService) {}

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resolve a payment exception (credit/refund/duplicate/reassign/attribute)' })
  async resolve(@Param('id') id: string, @Body() dto: ResolveExceptionDto) {
    const data = await this.exceptions.resolve(id, dto.action, dto.targetUnitId);
    return { message: data.message, data };
  }
}
