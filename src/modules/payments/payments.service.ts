import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { Prisma, PaymentStatus, ExceptionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ReconciliationService } from '../reconciliation/reconciliation.service';
import { RealtimeService } from '../realtime/realtime.service';
import { NotifierService } from '../notifier/notifier.service';
import { NombaService } from '../nomba/nomba.service';
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
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly recon: ReconciliationService,
    private readonly realtime: RealtimeService,
    private readonly notifier: NotifierService,
    private readonly nomba: NombaService,
  ) {}

  /**
   * Safety net for dropped or retry-exhausted webhooks: periodically pull recent
   * Nomba sub-account transactions and re-ingest any inbound virtual-account credit
   * we don't already have. Safe to run repeatedly — `ingestInboundPayment` dedupes on
   * nombaTxnRef, and a secondary unit+amount+window check blocks a double-credit when
   * the webhook already booked the same transfer under a different ref.
   *
   * Only `entryType === 'CREDIT'` + `status === 'SUCCESS'` records are ingested, so
   * outbound payouts (DEBIT), refunds and pending rows are never booked as payments.
   * An inbound credit's receiving VA is `virtualAccountReference` (== Account.accountRef).
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async backfillMissedPayments(): Promise<void> {
    const dateTo = new Date();
    const dateFrom = new Date(dateTo.getTime() - 60 * 60_000); // last hour

    let cursor: string | undefined;
    let fetched = 0;
    let matched = 0;
    let ingested = 0;

    try {
      do {
        const page = await this.nomba.fetchSubAccountTransactions({
          limit: 50,
          cursor,
          dateFrom: dateFrom.toISOString(),
          dateTo: dateTo.toISOString(),
        });
        for (const it of page.results) {
          fetched++;

          // Inbound, settled virtual-account credits only — never a payout (DEBIT),
          // refund, or pending row.
          if (it?.entryType !== 'CREDIT' || it?.status !== 'SUCCESS') continue;

          const ref: string | undefined = it?.id ?? it?.transactionId;
          const amountNaira = Number(it?.amount);
          if (!ref || !Number.isFinite(amountNaira) || amountNaira <= 0) continue;

          const accountRef: string | null = it?.virtualAccountReference ?? null;
          const accountNumber: string | null = it?.recipientAccountNumber ?? null;
          const accountInclude = {
            unit: { select: { id: true, estate: { select: { duplicateWindowSecs: true } } } },
          } as const;
          const account = accountRef
            ? await this.prisma.account.findUnique({ where: { accountRef }, include: accountInclude })
            : accountNumber
              ? await this.prisma.account.findFirst({ where: { accountNumber }, include: accountInclude })
              : null;
          if (!account) continue;
          matched++;

          const amountKobo = nairaToKobo(amountNaira);
          const receivedAtMs = it?.timeCreated ? new Date(it.timeCreated).getTime() : Date.now();

          // Exact idempotency on the transaction id.
          const existing = await this.prisma.payment.findUnique({ where: { nombaTxnRef: ref } });
          if (existing) continue;

          // Secondary dedupe: the webhook may have already booked this same credit
          // under a different ref — skip if a payment for this unit + amount landed
          // within the estate's duplicate window.
          const windowMs = account.unit.estate.duplicateWindowSecs * 1000;
          const alreadyBooked = await this.prisma.payment.findFirst({
            where: {
              unitId: account.unit.id,
              grossAmountKobo: amountKobo,
              receivedAt: {
                gte: new Date(receivedAtMs - windowMs),
                lte: new Date(receivedAtMs + windowMs),
              },
            },
          });
          if (alreadyBooked) continue;

          try {
            const res = await this.ingestInboundPayment({
              nombaTxnRef: ref,
              accountRef,
              accountNumber,
              amountKobo,
              sourceName: it?.senderName ?? it?.ktaSenderName ?? 'Unknown sender',
              sourceAccount: it?.ktaSenderAccountNumber ?? null,
              receivedAt: receivedAtMs,
              rawPayload: { channel: 'backfill', item: it },
            });
            if (!res.deduped) ingested++;
          } catch (err) {
            this.logger.error(`Backfill: failed to ingest txn ${ref}`, err as Error);
          }
        }
        cursor = page.cursor || undefined;
      } while (cursor);
    } catch (err) {
      this.logger.error('Backfill: failed to fetch/process Nomba transactions', err as Error);
      return;
    }

    if (fetched === 0 || matched === 0) {
      this.logger.warn(
        `Backfill: fetched ${fetched} txns, matched ${matched} credits to our accounts — verify fetchSubAccountTransactions shape if this stays 0`,
      );
    } else {
      this.logger.log(`Backfill: fetched ${fetched}, matched ${matched}, newly ingested ${ingested}`);
    }
  }

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

  /**
   * Inbound payment reversal — Nomba clawed back a settled transfer.
   *
   * Policy: flag for manual review, do NOT auto-unwind the ledger. The credit
   * from the original payment may already have been spent on a later charge, so
   * an automatic reversal could leave the unit in an inconsistent state. Instead
   * we mark the payment REVERSED and raise a REVERSAL exception for a manager.
   *
   * `candidateRefs` are the possible references to the ORIGINAL payment; the exact
   * field Nomba uses to link a reversal to its origin is unverified, so we try
   * several. Returns { reversed: false } (logged, not thrown) when none match.
   */
  async reverseInboundPayment(candidateRefs: (string | null | undefined)[]): Promise<{ reversed: boolean }> {
    const refs = candidateRefs.filter((r): r is string => !!r);
    const original = refs.length
      ? await this.prisma.payment.findFirst({ where: { nombaTxnRef: { in: refs } } })
      : null;

    if (!original) {
      this.logger.warn(`Reversal received but no matching original payment for refs=[${refs.join(', ')}]`);
      return { reversed: false };
    }
    if (original.status === PaymentStatus.REVERSED) return { reversed: true }; // idempotent

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: original.id }, data: { status: PaymentStatus.REVERSED } });
      // Exception.paymentId is unique — only attach one if the payment doesn't
      // already carry an (unresolved) exception from its original reconciliation.
      const existing = await tx.exception.findUnique({ where: { paymentId: original.id } });
      if (!existing) {
        await tx.exception.create({
          data: {
            paymentId: original.id,
            type: ExceptionType.REVERSAL,
            suggestion: `Payment of ${formatNaira(original.grossAmountKobo)} from ${original.sourceName} was reversed by Nomba — review and adjust the unit's balance.`,
          },
        });
      }
      await tx.activity.create({
        data: {
          estateId: original.estateId,
          unitId: original.unitId,
          message: `Payment from ${original.sourceName} reversed — unit balance needs review`,
        },
      });
    });

    this.realtime.broadcast(original.estateId, 'payment');
    return { reversed: true };
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
