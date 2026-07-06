import { Body, Controller, Delete, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { AssignGroupDto } from './dto/assign-group.dto';

@ApiTags('Unit Groups')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('estate/:estateId')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Post('groups')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a unit group' })
  async create(@Param('estateId') estateId: string, @Body() dto: CreateGroupDto) {
    const data = await this.groups.createGroup(estateId, dto.name);
    return { message: 'Group created', data };
  }

  @Delete('groups/:groupId')
  @ApiOperation({ summary: 'Delete a unit group (its units become ungrouped)' })
  async remove(@Param('estateId') estateId: string, @Param('groupId') groupId: string) {
    const data = await this.groups.deleteGroup(estateId, groupId);
    return { message: 'Group removed', data };
  }

  @Patch('units/:unitId/group')
  @ApiOperation({ summary: 'Assign a unit to a group, or ungroup it (groupId: null)' })
  async assign(
    @Param('estateId') estateId: string,
    @Param('unitId') unitId: string,
    @Body() dto: AssignGroupDto,
  ) {
    const data = await this.groups.assignUnit(estateId, unitId, dto.groupId ?? null);
    return { message: 'Unit group updated', data };
  }
}
