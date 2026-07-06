import { Injectable, NotFoundException } from '@nestjs/common';
import { ExceptionStatus, PaymentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { RealtimeService } from '../realtime/realtime.service';
import { applyReconEffects, recomputeUnitRollups } from '../payments/apply';
import { chargeKind } from '../../common/domain';
import { formatNaira } from '../../common/money';

export type ResolveAction =
  | 'credit'
  | 'refund'
  | 'duplicate-hold'
  | 'duplicate-keep'
  | 'reassign'
  | 'attribute'
  | 'acknowledge';

@Injectable()
export class ExceptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recon: ReconciliationService,
    private readonly realtime: RealtimeService,
  ) {}

  async resolve(exceptionId: string, action: ResolveAction, targetUnitId?: string) {
    const exception = await this.prisma.exception.findUnique({ where: { id: exceptionId }, include: { payment: true } });
    if (!exception || exception.status === ExceptionStatus.RESOLVED) {
      throw new NotFoundException('Exception not found or already resolved');
    }
    const payment = exception.payment;
    const estateId = payment.estateId;
    let message = 'Resolved';

    await this.prisma.$transaction(async (tx) => {
      switch (exception.type) {
        case 'OVERPAYMENT': {
          const allocated = await tx.allocation.aggregate({ where: { paymentId: payment.id }, _sum: { amountKobo: true } });
          const surplus = payment.grossAmountKobo - (allocated._sum.amountKobo ?? 0);
          if (action === 'credit' && payment.unitId && surplus > 0) {
            await tx.creditEntry.create({ data: { unitId: payment.unitId, amountKobo: surplus, reason: 'Overpayment moved to credit' } });
            await recomputeUnitRollups(tx, payment.unitId);
            await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.OVERPAYMENT } });
            message = `${formatNaira(surplus)} surplus moved to credit`;
          } else {
            await tx.payment.update({ where: { id: payment.id }, data: { status: PaymentStatus.OVERPAYMENT } });
            message = `${formatNaira(surplus)} flagged for refund`;
          }
          break;
        }
        case 'DUPLICATE': {
          if (action === 'duplicate-keep' && payment.unitId) {
            await this.applyPaymentToUnit(tx, payment.id, payment.unitId, payment.grossAmountKobo, payment.sourceName);
            message = 'Treated as a separate payment';
          } else {
            message = 'Confirmed duplicate, held';
          }
          break;
        }
        case 'MISDIRECTED': {
          const dest = targetUnitId ?? exception.candidateUnitId ?? undefined;
          if (!dest) throw new NotFoundException('No target unit provided');
          await tx.payment.update({ where: { id: payment.id }, data: { unitId: dest } });
          await this.applyPaymentToUnit(tx, payment.id, dest, payment.grossAmountKobo, payment.sourceName);
          message = 'Reassigned to the correct unit';
          break;
        }
        case 'THIRD_PARTY': {
          if (payment.unitId) {
            await this.applyPaymentToUnit(tx, payment.id, payment.unitId, payment.grossAmountKobo, payment.sourceName, 'Paid on behalf');
            message = 'Attributed and tagged as paid on behalf';
          }
          break;
        }
        case 'REVERSAL': {
          // Manual-review policy: the ledger is not auto-unwound. The manager
          // adjusts the unit by hand, then acknowledges to clear the flag.
          message = 'Reversal acknowledged';
          break;
        }
      }

      await tx.exception.update({ where: { id: exception.id }, data: { status: ExceptionStatus.RESOLVED, resolvedAt: new Date(), resolutionNote: message } });
      await tx.activity.create({ data: { estateId, unitId: payment.unitId, message: `Exception resolved: ${message}` } });
    });

    this.realtime.broadcast(estateId, 'exception');
    return { ok: true, message };
  }

  private async applyPaymentToUnit(
    tx: Prisma.TransactionClient,
    paymentId: string,
    unitId: string,
    amountKobo: number,
    sourceName: string,
    tag?: string,
  ): Promise<void> {
    const unit = await tx.unit.findUniqueOrThrow({ where: { id: unitId } });
    const estate = await tx.estate.findUniqueOrThrow({ where: { id: unit.estateId } });
    const openCharges = await tx.charge.findMany({ where: { unitId, status: { not: 'SETTLED' } } });

    const result = this.recon.reconcile({
      payment: { amountKobo, receivedAt: Date.now(), sourceName },
      charges: openCharges.map((c) => ({ id: c.id, kind: chargeKind(c.sourceType), outstandingKobo: c.outstandingKobo, dueDate: c.dueDate.getTime() })),
      creditBalanceKobo: unit.creditBalanceKobo,
      occupantName: unit.occupant,
      rule: estate.allocationRule,
      // Manual attribution IS the credit/refund decision: never re-hold surplus as a
      // fresh overpayment exception (which applyReconEffects would silently drop,
      // leaving the payment invisible). Any surplus beyond open charges — including a
      // payment to an unbilled unit with no charges — becomes this unit's credit.
      autoCreditThresholdKobo: Number.MAX_SAFE_INTEGER,
      duplicateWindowSecs: estate.duplicateWindowSecs,
      priorPayments: [],
      unitMatched: true,
      forceApply: true,
    });

    await applyReconEffects(tx, {
      paymentId,
      unitId,
      result,
      charges: openCharges.map((c) => ({ id: c.id, outstandingKobo: c.outstandingKobo, originalAmountKobo: c.originalAmountKobo })),
    });

    await tx.payment.update({ where: { id: paymentId }, data: { status: result.status as PaymentStatus, tag: tag ?? null } });
  }
}
