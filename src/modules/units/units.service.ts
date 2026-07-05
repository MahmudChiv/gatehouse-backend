import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';

@Injectable()
export class UnitsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  // Edit resident contact fields. `undefined` leaves a field untouched; an empty
  // phone string clears it to null (the column is nullable). Email is required by
  // the schema, so it is only written when a value is supplied.
  async updateContact(estateId: string, unitId: string, data: { email?: string; phone?: string }) {
    await this.assertUnit(estateId, unitId);
    const updated = await this.prisma.unit.update({
      where: { id: unitId },
      data: {
        email: data.email ?? undefined,
        phone: data.phone === undefined ? undefined : data.phone.trim() || null,
      },
    });
    this.realtime.broadcast(estateId, 'unit');
    return { id: updated.id, email: updated.email, phone: updated.phone };
  }

  // Soft delete — the state query filters on deletedAt: null, so the unit drops
  // out of every view while its history (payments, charges, virtual account) is
  // preserved for the record.
  async softDelete(estateId: string, unitId: string) {
    await this.assertUnit(estateId, unitId);
    await this.prisma.unit.update({ where: { id: unitId }, data: { deletedAt: new Date() } });
    this.realtime.broadcast(estateId, 'unit');
    return { id: unitId };
  }

  private async assertUnit(estateId: string, unitId: string) {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, estateId, deletedAt: null } });
    if (!unit) throw new NotFoundException('Unit not found');
    return unit;
  }
}
