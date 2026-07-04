import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { koboToNaira } from '../../common/money';
import { agingBucket, type AgingBucket } from '../reconciliation/reconciliation';

export interface Reports {
  collected: number;
  outstanding: number;
  spent: number;
  balance: number;
  collectionRate: number;
  byCategory: { category: string; amount: number }[];
  collectionSeries: { date: string; amount: number }[];
  arrears: {
    buckets: Record<AgingBucket, number>;
    units: { unitId: string; label: string; occupant: string; outstanding: number; oldestDue: number }[];
  };
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  async getReports(estateId: string): Promise<Reports> {
    const [charges, payouts, payments, units] = await Promise.all([
      this.prisma.charge.findMany({
        where: { unit: { estateId } },
        select: { originalAmountKobo: true, outstandingKobo: true, dueDate: true, unitId: true },
      }),
      this.prisma.payout.findMany({ where: { estateId }, include: { vendor: { select: { category: true } } } }),
      this.prisma.payment.findMany({ where: { estateId }, include: { allocations: true } }),
      this.prisma.unit.findMany({ where: { estateId, deletedAt: null }, select: { id: true, unitName: true, occupant: true } }),
    ]);

    const billedKobo = charges.reduce((a, c) => a + c.originalAmountKobo, 0);
    const outstandingKobo = charges.reduce((a, c) => a + c.outstandingKobo, 0);
    const collectedKobo = billedKobo - outstandingKobo;
    const spentKobo = payouts.filter((p) => p.status !== 'FAILED').reduce((a, p) => a + p.amountKobo, 0);

    const byCategory = new Map<string, number>();
    for (const p of payouts) {
      if (p.status === 'FAILED') continue;
      const cat = p.vendor?.category ?? 'Other';
      byCategory.set(cat, (byCategory.get(cat) ?? 0) + p.amountKobo);
    }

    const series = new Map<string, number>();
    const now = Date.now();
    for (const p of payments) {
      const applied = p.allocations.reduce((a, x) => a + x.amountKobo, 0);
      if (applied <= 0) continue;
      if (p.receivedAt.getTime() < now - 14 * 86_400_000) continue;
      const key = p.receivedAt.toISOString().slice(0, 10);
      series.set(key, (series.get(key) ?? 0) + applied);
    }

    const unitById = new Map(units.map((u) => [u.id, u]));
    const buckets: Record<AgingBucket, number> = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
    const arrearsByUnit = new Map<string, { outstanding: number; oldestDue: number }>();
    for (const c of charges) {
      if (c.outstandingKobo <= 0) continue;
      const bucket = agingBucket(c.dueDate.getTime(), now);
      buckets[bucket] += c.outstandingKobo;
      const prev = arrearsByUnit.get(c.unitId);
      arrearsByUnit.set(c.unitId, {
        outstanding: (prev?.outstanding ?? 0) + c.outstandingKobo,
        oldestDue: Math.min(prev?.oldestDue ?? Infinity, c.dueDate.getTime()),
      });
    }

    return {
      collected: koboToNaira(collectedKobo),
      outstanding: koboToNaira(outstandingKobo),
      spent: koboToNaira(spentKobo),
      balance: koboToNaira(collectedKobo - spentKobo),
      collectionRate: billedKobo > 0 ? Math.round((collectedKobo / billedKobo) * 100) : 0,
      byCategory: [...byCategory.entries()].map(([category, amount]) => ({ category, amount: koboToNaira(amount) })),
      collectionSeries: [...series.entries()].sort().map(([date, amount]) => ({ date, amount: koboToNaira(amount) })),
      arrears: {
        buckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, koboToNaira(v)])) as Record<AgingBucket, number>,
        units: [...arrearsByUnit.entries()]
          .map(([unitId, v]) => ({
            unitId,
            label: unitById.get(unitId)?.unitName ?? unitId,
            occupant: unitById.get(unitId)?.occupant ?? '',
            outstanding: koboToNaira(v.outstanding),
            oldestDue: v.oldestDue,
          }))
          .sort((a, b) => b.outstanding - a.outstanding),
      },
    };
  }
}
