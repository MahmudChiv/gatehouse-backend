import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StateService } from '../state/state.service';
import type { Unit } from '../state/state.types';

export interface PublicStatement {
  estate: { name: string; city: string };
  unit: Unit;
  accountNumber: string;
  bankName: string;
  transparency: {
    collected: number;
    spent: number;
    balance: number;
    byCategory: { category: string; amount: number }[];
  };
}

@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: StateService,
  ) {}

  async getPublicStatement(tokenOrUnitId: string): Promise<PublicStatement | null> {
    const link = await this.prisma.residentLink.findUnique({ where: { token: tokenOrUnitId }, include: { unit: true } });
    const unitRow = link?.unit ?? (await this.prisma.unit.findUnique({ where: { id: tokenOrUnitId } }));
    if (!unitRow) return null;

    if (link) {
      await this.prisma.residentLink.update({ where: { id: link.id }, data: { lastViewedAt: new Date() } });
    }

    const state = await this.state.getEstateState(unitRow.estateId);
    const unit = state.units.find((u) => u.id === unitRow.id);
    if (!unit) return null;

    const spent = state.payouts.filter((p) => p.status !== 'failed').reduce((a, p) => a + p.amount, 0);
    const collected = state.units.reduce((a, u) => a + u.charges.reduce((b, c) => b + c.paid, 0), 0);
    const categoryByVendor = new Map(state.vendors.map((v) => [v.id, v.category]));
    const byCategoryMap = new Map<string, number>();
    for (const p of state.payouts) {
      if (p.status === 'failed') continue;
      const cat = categoryByVendor.get(p.vendorId) ?? 'Other';
      byCategoryMap.set(cat, (byCategoryMap.get(cat) ?? 0) + p.amount);
    }

    const account = await this.prisma.account.findUnique({ where: { unitId: unitRow.id } });

    return {
      estate: { name: state.estate.name, city: state.estate.city },
      unit,
      accountNumber: account?.accountNumber ?? unit.accountNumber,
      bankName: account?.bankName ?? '',
      transparency: {
        collected,
        spent,
        balance: collected - spent,
        byCategory: [...byCategoryMap.entries()].map(([category, amount]) => ({ category, amount })),
      },
    };
  }
}
