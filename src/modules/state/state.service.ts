import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { koboToNaira } from '../../common/money';
import type {
  State,
  Unit,
  LedgerEntry,
  Payment,
  ExceptionItem,
  UnitStatus,
  PaymentStatus,
  ExceptionType,
} from './state.types';

const unitStatusMap: Record<string, UnitStatus> = {
  PAID: 'paid',
  PARTIAL: 'partial',
  OVERDUE: 'overdue',
  UNBILLED: 'unbilled',
  CREDIT: 'credit',
};
const paymentStatusMap: Record<string, PaymentStatus> = {
  MATCHED: 'matched',
  PARTIAL: 'partial',
  OVERPAYMENT: 'overpayment',
  EXCEPTION: 'exception',
  MANUAL: 'manual',
  REVERSED: 'reversed',
};
const exceptionTypeMap: Record<string, ExceptionType> = {
  OVERPAYMENT: 'overpayment',
  DUPLICATE: 'duplicate',
  MISDIRECTED: 'misdirected',
  THIRD_PARTY: 'third_party',
  REVERSAL: 'reversal',
};

@Injectable()
export class StateService {
  constructor(private readonly prisma: PrismaService) {}

  async updateEstate(
    id: string,
    data: { name?: string; address?: string; city?: string; cycleLabel?: string; allocationRule?: 'OLDEST_FIRST' | 'DUES_FIRST'; autoCreditThresholdKobo?: number },
  ) {
    return this.prisma.estate.update({ where: { id }, data });
  }

  async getEstateState(estateId: string): Promise<State> {
    const estate = await this.prisma.estate.findUniqueOrThrow({ where: { id: estateId } });

    const [units, payments, vendors, payouts, billingRuns, levies, activity, groups, allVendorNames] = await Promise.all([
      this.prisma.unit.findMany({
        where: { estateId, deletedAt: null },
        include: { account: true, charges: true, creditEntries: true },
        orderBy: [{ block: 'asc' }, { unitName: 'asc' }],
      }),
      this.prisma.payment.findMany({
        where: { estateId },
        include: { allocations: true, exception: true },
        orderBy: { receivedAt: 'desc' },
      }),
      this.prisma.vendor.findMany({ where: { estateId, deletedAt: null }, include: { payouts: true } }),
      this.prisma.payout.findMany({ where: { estateId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.billingRun.findMany({
        where: { estateId },
        orderBy: { createdAt: 'desc' },
        include: { charges: { select: { originalAmountKobo: true, outstandingKobo: true } } },
      }),
      this.prisma.fee.findMany({
        where: { estateId, type: 'levy', deletedAt: null },
        orderBy: { createdAt: 'desc' },
        include: { charges: { select: { originalAmountKobo: true, outstandingKobo: true } } },
      }),
      this.prisma.activity.findMany({ where: { estateId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.unitGroup.findMany({ where: { estateId }, orderBy: { createdAt: 'asc' } }),
      // Names for ALL vendors (including soft-deleted) so payout history can label a
      // payout even after its vendor is removed from the active list.
      this.prisma.vendor.findMany({ where: { estateId }, select: { id: true, name: true } }),
    ]);
    const vendorNameById = new Map(allVendorNames.map((v) => [v.id, v.name]));

    type PaymentRow = (typeof payments)[number];
    const paymentsByUnit = new Map<string, PaymentRow[]>();
    for (const p of payments) {
      if (!p.unitId) continue;
      const list = paymentsByUnit.get(p.unitId) ?? [];
      list.push(p);
      paymentsByUnit.set(p.unitId, list);
    }

    const unitViews: Unit[] = units.map((u) => {
      const charges = u.charges
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((c) => ({
          id: c.id,
          description: c.description,
          amount: koboToNaira(c.originalAmountKobo),
          paid: koboToNaira(c.originalAmountKobo - c.outstandingKobo),
          createdAt: c.createdAt.getTime(),
          dueAt: c.dueDate.getTime(),
          cycle: c.cycleLabel,
          kind: c.sourceType === 'service_fee' ? ('service' as const) : ('levy' as const),
        }));

      return {
        id: u.id,
        label: u.unitName,
        block: u.block,
        groupId: u.groupId ?? null,
        occupant: u.occupant,
        phone: u.phone ?? '',
        email: u.email,
        accountNumber: u.account?.accountNumber ?? '—',
        occupantType: u.type === 'owner' ? 'owner' : 'tenant',
        balance: koboToNaira(u.balanceKobo),
        credit: koboToNaira(u.creditBalanceKobo),
        status: unitStatusMap[u.status] ?? 'unbilled',
        lastPaymentAt: u.lastPaymentAt?.getTime(),
        charges,
        ledger: this.buildLedger(u.id, u.charges, u.creditEntries, paymentsByUnit.get(u.id) ?? [], estate.cycleLabel ?? ''),
      };
    });

    const paymentViews: Payment[] = payments.map((p) => {
      const applied = p.allocations.reduce((a, x) => a + x.amountKobo, 0);
      return {
        id: p.id,
        unitId: p.unitId,
        amount: koboToNaira(p.grossAmountKobo),
        timestamp: p.receivedAt.getTime(),
        sender: p.sourceName,
        status: paymentStatusMap[p.status] ?? 'matched',
        allocation:
          p.tag ??
          (applied > 0 ? `Applied to ${estate.cycleLabel || 'open'} charges` : p.exception?.suggestion ?? ''),
        exceptionType: p.exception && p.exception.status === 'OPEN' ? exceptionTypeMap[p.exception.type] : undefined,
      };
    });

    const exceptionViews: ExceptionItem[] = payments
      .filter((p) => p.exception && p.exception.status === 'OPEN')
      .map((p) => ({
        id: p.exception!.id,
        paymentId: p.id,
        type: exceptionTypeMap[p.exception!.type],
        suggestion: p.exception!.suggestion,
        candidateUnitId: p.exception!.candidateUnitId ?? undefined,
      }));

    const payoutTotalByVendor = new Map<string, number>();
    for (const po of payouts) {
      if (po.status === 'FAILED') continue;
      payoutTotalByVendor.set(po.vendorId, (payoutTotalByVendor.get(po.vendorId) ?? 0) + po.amountKobo);
    }

    return {
      estate: { id: estate.id, name: estate.name, address: estate.address, city: estate.city },
      cycle: estate.cycleLabel ?? '',
      allocationRule: estate.allocationRule,
      units: unitViews,
      payments: paymentViews,
      exceptions: exceptionViews,
      vendors: vendors.map((v) => ({
        id: v.id,
        name: v.name,
        category: v.category,
        bank: v.bankName,
        bankCode: v.bankCode ?? '',
        account: v.accountNumber,
        totalPaid: koboToNaira(payoutTotalByVendor.get(v.id) ?? 0),
      })),
      payouts: payouts.map((po) => ({
        id: po.id,
        vendorId: po.vendorId,
        vendorName: vendorNameById.get(po.vendorId) ?? 'Removed vendor',
        amount: koboToNaira(po.amountKobo),
        note: po.note,
        date: po.createdAt.getTime(),
        status: po.status.toLowerCase() as 'pending' | 'success' | 'failed' | 'reversed',
      })),
      billingRuns: billingRuns.map((r) => {
        const collected = r.charges.reduce((a, c) => a + (c.originalAmountKobo - c.outstandingKobo), 0);
        const total = r.charges.reduce((a, c) => a + c.originalAmountKobo, 0);
        return {
          id: r.id,
          cycle: r.cycleLabel,
          chargeAmount: koboToNaira(r.chargeAmountKobo),
          unitsBilled: r.charges.length,
          total: koboToNaira(total),
          collected: koboToNaira(collected),
          createdAt: r.createdAt.getTime(),
        };
      }),
      levies: levies.map((l) => {
        const collected = l.charges.reduce((a, c) => a + (c.originalAmountKobo - c.outstandingKobo), 0);
        const total = l.charges.reduce((a, c) => a + c.originalAmountKobo, 0);
        return {
          id: l.id,
          name: l.name,
          amount: koboToNaira(l.amountKobo),
          dueDate: l.dueDate?.getTime() ?? l.createdAt.getTime(),
          unitsBilled: l.charges.length,
          total: koboToNaira(total),
          collected: koboToNaira(collected),
          requireExact: l.requireExact,
        };
      }),
      activity: activity.map((a) => ({
        id: a.id,
        timestamp: a.createdAt.getTime(),
        message: a.message,
        unitId: a.unitId ?? undefined,
      })),
      groups: groups.map((g) => ({ id: g.id, name: g.name })),
      recentlyChanged: {},
    };
  }

  // running balance == original charges − allocated payments (incl. credit applied) at every row (PRD §8).
  private buildLedger(
    unitId: string,
    charges: { id: string; description: string; originalAmountKobo: number; outstandingKobo: number; createdAt: Date }[],
    creditEntries: { id: string; amountKobo: number; reason: string; createdAt: Date }[],
    payments: { receivedAt: Date; tag: string | null; status: string; grossAmountKobo: number; allocations: { amountKobo: number }[] }[],
    cycle: string,
  ): LedgerEntry[] {
    interface Ev {
      date: number;
      description: string;
      kind: 'charge' | 'payment' | 'credit';
      amount: number;
      affects: boolean;
      allocation?: string;
      order: number;
      settled?: 'paid' | 'partial' | 'unpaid';
    }
    const evs: Ev[] = [];

    for (const c of charges) {
      const settled: 'paid' | 'partial' | 'unpaid' =
        c.outstandingKobo <= 0 ? 'paid' : c.outstandingKobo >= c.originalAmountKobo ? 'unpaid' : 'partial';
      evs.push({ date: c.createdAt.getTime(), description: c.description, kind: 'charge', amount: koboToNaira(c.originalAmountKobo), affects: true, order: 0, settled });
    }
    for (const p of payments) {
      const applied = p.allocations.reduce((a, x) => a + x.amountKobo, 0);
      if (applied > 0) {
        evs.push({
          date: p.receivedAt.getTime(),
          description: p.tag ? `Transfer received — ${p.tag}` : 'Transfer received',
          kind: 'payment',
          amount: -koboToNaira(applied),
          affects: true,
          allocation: `Applied to ${cycle || 'open'} charges`,
          order: 1,
        });
      } else if (p.status !== 'EXCEPTION') {
        // Landed but unallocated (e.g. attributed to an unbilled unit): show the
        // incoming transfer without moving the owed balance — the money is held as
        // credit, surfaced by the credit rows below.
        evs.push({
          date: p.receivedAt.getTime(),
          description: p.tag ? `Transfer received — ${p.tag}` : 'Transfer received',
          kind: 'payment',
          amount: -koboToNaira(p.grossAmountKobo),
          affects: false,
          allocation: 'Held as credit balance',
          order: 1,
        });
      }
    }
    for (const ce of creditEntries) {
      if (ce.amountKobo < 0) {
        evs.push({ date: ce.createdAt.getTime(), description: 'Credit applied', kind: 'credit', amount: koboToNaira(ce.amountKobo), affects: true, allocation: ce.reason, order: 1 });
      } else {
        evs.push({ date: ce.createdAt.getTime(), description: 'Overpayment — credit', kind: 'credit', amount: -koboToNaira(ce.amountKobo), affects: false, allocation: 'Held as credit balance', order: 2 });
      }
    }

    evs.sort((a, b) => a.date - b.date || a.order - b.order);
    let running = 0;
    return evs.map((e, i) => {
      if (e.affects) running += e.amount;
      return { id: `${unitId}-le-${i}`, date: e.date, description: e.description, kind: e.kind, amount: e.amount, running, allocation: e.allocation, settled: e.settled };
    });
  }
}
