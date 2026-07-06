import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class GroupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async createGroup(estateId: string, name: string) {
    await this.prisma.estate.findUniqueOrThrow({ where: { id: estateId } });
    const group = await this.prisma.unitGroup.create({ data: { estateId, name } });
    this.realtime.broadcast(estateId, 'group');
    return group;
  }

  // Deleting a group reverts its units to ungrouped via the schema's default
  // SetNull on Unit.groupId — no manual unit update needed.
  async deleteGroup(estateId: string, groupId: string) {
    const group = await this.prisma.unitGroup.findFirst({ where: { id: groupId, estateId } });
    if (!group) throw new NotFoundException('Group not found');
    await this.prisma.unitGroup.delete({ where: { id: groupId } });
    this.realtime.broadcast(estateId, 'group');
    return { id: groupId };
  }

  async assignUnit(estateId: string, unitId: string, groupId: string | null) {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, estateId, deletedAt: null } });
    if (!unit) throw new NotFoundException('Unit not found');
    if (groupId) {
      const group = await this.prisma.unitGroup.findFirst({ where: { id: groupId, estateId } });
      if (!group) throw new NotFoundException('Group not found');
    }
    const updated = await this.prisma.unit.update({ where: { id: unitId }, data: { groupId } });
    this.realtime.broadcast(estateId, 'group');
    return { id: updated.id, groupId: updated.groupId };
  }
}
