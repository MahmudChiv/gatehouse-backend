import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma, PaymentStatus, ExceptionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotifierService } from '../notifier/notifier.service';
import type { ReconResult } from '../reconciliation/reconciliation';
import { applyReconEffects } from './apply';
import { chargeKind } from '../../common/domain';
import { formatNaira, nairaToKobo } from '../../common/money';

export interface InboundPayment {
  nombaTxnRef: string;
  accountRef?: string | null;
  accountNumber?: string | null;
  amountKobo: number;
  sourceName: string;
  sourceAccount?: string | null;
  receivedAt: number; // epoch ms
  rawPayload?: unknown;
  status?: PaymentStatus; // e.g. MANUAL
  estateIdHint?: string;
}

export interface IngestResult {
  deduped: boolean;
  paymentId: string;
  status: PaymentStatus;
  exceptionType?: ExceptionType;
}

@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly recon: ReconciliationService,
    private readonly realtime: RealtimeService,
    private readonly notifier: NotifierService,
  ) {}

  /** The single inbound-payment path: dedupe → reconcile → persist → broadcast. */
  async ingestInboundPayment(input: InboundPayment): Promise<IngestResult> {
    // 1. Idempotency — a re-delivered webhook must never double-credit.
    const existing = await this.prisma.payment.findUnique({ where: { nombaTxnRef: input.nombaTxnRef } });
    if (existing) return { deduped: true, paymentId: existing.id, status: existing.status };

    // 2. Resolve the receiving virtual account → unit.
    const account = input.accountRef
      ? await this.prisma.account.findUnique({ where: { accountRef: input.accountRef }, include: { unit: true } })
      : input.accountNumber
        ? await this.prisma.account.findFirst({ where: { accountNumber: input.accountNumber }, include: { unit: true } })
        : null;

    // 3. Resolve the estate.
    let estateId = input.estateIdHint ?? account?.unit.estateId;
    if (!estateId) estateId = (await this.prisma.estate.findFirst({ select: { id: true } }))?.id;
    if (!estateId) throw new Error('NO_ESTATE');

    const receivedAt = new Date(input.receivedAt);

    // 4a. Misdirected: no unit owns the account.
    if (!account) {
      const payment = await this.prisma.payment.create({
        data: {
          estateId,
          unitId: null,
          nombaTxnRef: input.nombaTxnRef,
          grossAmountKobo: input.amountKobo,
          sourceName: input.sourceName,
          sourceAccount: input.sourceAccount ?? null,
          receivedAt,
          status: PaymentStatus.EXCEPTION,
          rawPayload: (input.rawPayload as Prisma.InputJsonValue) ?? undefined,
          exception: {
            create: {
              type: ExceptionType.MISDIRECTED,
              suggestion: 'No unit matched the receiving account — reassign to the correct unit.',
            },
          },
        },
      });
      await this.prisma.activity.create({
        data: { estateId, message: `Unmatched payment of ${formatNaira(input.amountKobo)} from ${input.sourceName}` },
      });
      this.realtime.broadcast(estateId, 'payment');
      return { deduped: false, paymentId: payment.id, status: PaymentStatus.EXCEPTION, exceptionType: ExceptionType.MISDIRECTED };
    }

    // 4b. Matched unit — reconcile.
    const unit = account.unit;
    const estate = await this.prisma.estate.findUniqueOrThrow({ where: { id: unit.estateId } });
    const openCharges = await this.prisma.charge.findMany({ where: { unitId: unit.id, status: { not: 'SETTLED' } } });
    const windowStart = new Date(input.receivedAt - estate.duplicateWindowSecs * 1000);
    const priors = await this.prisma.payment.findMany({ where: { unitId: unit.id, receivedAt: { gte: windowStart } } });

    const result = this.recon.reconcile({
      payment: { amountKobo: input.amountKobo, receivedAt: input.receivedAt, sourceName: input.sourceName },
      charges: openCharges.map((c) => ({
        id: c.id,
        kind: chargeKind(c.sourceType),
        outstandingKobo: c.outstandingKobo,
        dueDate: c.dueDate.getTime(),
      })),
      creditBalanceKobo: unit.creditBalanceKobo,
      occupantName: unit.occupant,
      rule: estate.allocationRule,
      autoCreditThresholdKobo: estate.autoCreditThresholdKobo,
      duplicateWindowSecs: estate.duplicateWindowSecs,
      priorPayments: priors.map((p) => ({ amountKobo: p.grossAmountKobo, sourceName: p.sourceName, receivedAt: p.receivedAt.getTime() })),
      unitMatched: true,
    });

    const paymentId = await this.persistReconciled({
      estateId: unit.estateId,
      unitId: unit.id,
      unitLabel: unit.unitName,
      occupant: { name: unit.occupant, email: unit.email },
      nombaTxnRef: input.nombaTxnRef,
      grossAmountKobo: input.amountKobo,
      sourceName: input.sourceName,
      sourceAccount: input.sourceAccount ?? null,
      receivedAt,
      rawPayload: input.rawPayload,
      baseStatus: input.status,
      result,
      charges: openCharges.map((c) => ({ id: c.id, outstandingKobo: c.outstandingKobo, originalAmountKobo: c.originalAmountKobo })),
    });

    // Receipt for clean payments (fire and forget).
    if (!result.isException) {
      const balanceKobo = openCharges.reduce((a, c) => a + c.outstandingKobo, 0) -
        result.allocations.reduce((a, x) => a + x.amountKobo + x.fromCreditKobo, 0);
      this.notifier.receipt(
        { name: unit.occupant, email: unit.email },
        { unitLabel: unit.unitName, amountKobo: input.amountKobo, balanceKobo: Math.max(0, balanceKobo) },
      );
    }

    this.realtime.broadcast(unit.estateId, 'payment');
    return {
      deduped: false,
      paymentId,
      status: this.mapStatus(result, input.status),
      exceptionType: result.exceptionType as ExceptionType | undefined,
    };
  }

  /** Manual/cash entry — same path, flagged MANUAL. */
  async recordManualPayment(estateId: string, unitId: string, amountNaira: number, sender?: string): Promise<IngestResult> {
    const unit = await this.prisma.unit.findFirstOrThrow({ where: { id: unitId, estateId }, include: { account: true } });
    return this.ingestInboundPayment({
      nombaTxnRef: `manual-${randomUUID()}`,
      accountRef: unit.account?.accountRef ?? null,
      amountKobo: nairaToKobo(amountNaira),
      sourceName: sender || unit.occupant,
      receivedAt: Date.now(),
      status: PaymentStatus.MANUAL,
      estateIdHint: estateId,
      rawPayload: { channel: 'manual' },
    });
  }

  /** Dev simulate control — resolves a unit by label, then runs the real ingest path. */
  async simulatePayment(estateId: string, unitLabel: string, amountNaira: number): Promise<IngestResult> {
    const unit = unitLabel
      ? await this.prisma.unit.findFirst({
          where: { estateId, unitName: { equals: unitLabel, mode: 'insensitive' } },
          include: { account: true },
        })
      : null;
    return this.ingestInboundPayment({
      nombaTxnRef: `sim-${randomUUID()}`,
      accountRef: unit?.account?.accountRef ?? null,
      amountKobo: nairaToKobo(amountNaira),
      sourceName: unit?.occupant ?? 'Unknown sender',
      receivedAt: Date.now(),
      estateIdHint: estateId,
      rawPayload: { channel: 'simulate', unitLabel },
    });
  }

  private mapStatus(result: ReconResult, base?: PaymentStatus): PaymentStatus {
    if (base === PaymentStatus.MANUAL && !result.isException) return PaymentStatus.MANUAL;
    return result.status as PaymentStatus;
  }

  private async persistReconciled(p: {
    estateId: string;
    unitId: string;
    unitLabel: string;
    occupant: { name: string; email: string };
    nombaTxnRef: string;
    grossAmountKobo: number;
    sourceName: string;
    sourceAccount: string | null;
    receivedAt: Date;
    rawPayload?: unknown;
    baseStatus?: PaymentStatus;
    result: ReconResult;
    charges: { id: string; outstandingKobo: number; originalAmountKobo: number }[];
  }): Promise<string> {
    const { result } = p;
    return this.prisma.$transaction(async (tx) => {
      const payment = await tx.payment.create({
        data: {
          estateId: p.estateId,
          unitId: p.unitId,
          nombaTxnRef: p.nombaTxnRef,
          grossAmountKobo: p.grossAmountKobo,
          sourceName: p.sourceName,
          sourceAccount: p.sourceAccount,
          receivedAt: p.receivedAt,
          status: this.mapStatus(result, p.baseStatus),
          tag: result.tag ?? null,
          rawPayload: (p.rawPayload as Prisma.InputJsonValue) ?? undefined,
        },
      });

      await applyReconEffects(tx, { paymentId: payment.id, unitId: p.unitId, result, charges: p.charges });

      if (result.isException && result.exceptionType) {
        await tx.exception.create({
          data: {
            paymentId: payment.id,
            type: result.exceptionType as ExceptionType,
            suggestion: result.suggestion ?? 'Needs review',
          },
        });
      }

      await tx.activity.create({ data: { estateId: p.estateId, unitId: p.unitId, message: this.activityMessage(p.unitLabel, result) } });
      return payment.id;
    });
  }

  private activityMessage(unitLabel: string, result: ReconResult): string {
    const amt = formatNaira(result.allocations.reduce((a, x) => a + x.amountKobo, 0) + result.creditAddedKobo);
    switch (result.status) {
      case 'MATCHED':
        return `${unitLabel} paid, dues settled`;
      case 'PARTIAL':
        return `${unitLabel} paid ${amt}, balance still owing`;
      case 'OVERPAYMENT':
        return `${unitLabel} paid, ${formatNaira(result.creditAddedKobo)} moved to credit`;
      default:
        return `${unitLabel} payment needs review`;
    }
  }
}
