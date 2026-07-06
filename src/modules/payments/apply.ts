// Shared persistence of a ReconResult's financial effects (allocations, charge
// outstanding, credit movements, unit rollups). Used by both the ingest path
// (new payment) and exception resolution (existing held payment). Runs inside a
// caller-provided Prisma transaction.
import { Prisma } from '@prisma/client';
import type { ReconResult } from '../reconciliation/reconciliation';
import { deriveUnitStatus, chargeStatusFor } from '../../common/domain';

export interface ChargeSnapshot {
  id: string;
  outstandingKobo: number;
  originalAmountKobo: number;
}

/** Recompute a unit's balance/credit/status from the source of truth (charges +
 *  credit entries), guaranteeing balanceKobo == Σ outstanding (PRD §8). */
export async function recomputeUnitRollups(
  tx: Prisma.TransactionClient,
  unitId: string,
  opts: { touchLastPayment?: boolean } = {},
): Promise<{ balanceKobo: number; creditKobo: number }> {
  const [chargeAgg, creditAgg] = await Promise.all([
    tx.charge.aggregate({ where: { unitId }, _sum: { outstandingKobo: true, originalAmountKobo: true } }),
    tx.creditEntry.aggregate({ where: { unitId }, _sum: { amountKobo: true } }),
  ]);
  const balanceKobo = chargeAgg._sum.outstandingKobo ?? 0;
  const totalOriginal = chargeAgg._sum.originalAmountKobo ?? 0;
  const creditKobo = creditAgg._sum.amountKobo ?? 0;
  await tx.unit.update({
    where: { id: unitId },
    data: {
      balanceKobo,
      creditBalanceKobo: creditKobo,
      status: deriveUnitStatus(balanceKobo, creditKobo, totalOriginal),
      ...(opts.touchLastPayment ? { lastPaymentAt: new Date() } : {}),
    },
  });
  return { balanceKobo, creditKobo };
}

/** Immediately apply a unit's existing credit to its open charges, oldest-first
 *  (PRD §5.2 — billing applies existing credit at once). */
export async function consumeCreditForUnit(
  tx: Prisma.TransactionClient,
  unitId: string,
): Promise<void> {
  const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
  if (unit.creditBalanceKobo <= 0) return;
  const charges = await tx.charge.findMany({
    where: { unitId, status: { not: 'SETTLED' } },
    orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
  });
  let remaining = unit.creditBalanceKobo;
  for (const c of charges) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, c.outstandingKobo);
    if (take <= 0) continue;
    remaining -= take;
    const newOutstanding = c.outstandingKobo - take;
    await tx.charge.update({
      where: { id: c.id },
      data: { outstandingKobo: newOutstanding, status: chargeStatusFor(newOutstanding, c.originalAmountKobo) },
    });
    await tx.creditEntry.create({ data: { unitId, amountKobo: -take, reason: 'Credit applied to new charge' } });
  }
  await recomputeUnitRollups(tx, unitId);
}

/** Persist the allocations, credit entries, and unit rollups from a ReconResult. */
export async function applyReconEffects(
  tx: Prisma.TransactionClient,
  params: { paymentId: string; unitId: string; result: ReconResult; charges: ChargeSnapshot[] },
): Promise<void> {
  const { paymentId, unitId, result, charges } = params;
  const chargeById = new Map(charges.map((c) => [c.id, c]));

  for (const alloc of result.allocations) {
    const charge = chargeById.get(alloc.chargeId);
    if (!charge) continue;
    const reduction = alloc.amountKobo + alloc.fromCreditKobo;
    const newOutstanding = Math.max(0, charge.outstandingKobo - reduction);
    if (alloc.amountKobo > 0) {
      await tx.allocation.create({ data: { paymentId, chargeId: charge.id, amountKobo: alloc.amountKobo } });
    }
    await tx.charge.update({
      where: { id: charge.id },
      data: { outstandingKobo: newOutstanding, status: chargeStatusFor(newOutstanding, charge.originalAmountKobo) },
    });
  }

  if (result.creditAppliedKobo > 0) {
    await tx.creditEntry.create({ data: { unitId, amountKobo: -result.creditAppliedKobo, reason: 'Applied to charges' } });
  }
  if (result.creditAddedKobo > 0) {
    await tx.creditEntry.create({ data: { unitId, amountKobo: result.creditAddedKobo, reason: 'Overpayment surplus held as credit' } });
  }

  const hasFinancialEffect =
    result.allocations.length > 0 || result.creditAppliedKobo > 0 || result.creditAddedKobo > 0;
  if (hasFinancialEffect) {
    await recomputeUnitRollups(tx, unitId, { touchLastPayment: true });
  }
}
