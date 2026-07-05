import { Body, Controller, Headers, HttpCode, HttpStatus, Logger, Post, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { PayoutStatus } from '@prisma/client';
import { NombaService } from '../nomba/nomba.service';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { nairaToKobo } from '../../common/money';

// Nomba inbound webhook (PRD §7.3). Public (no JWT); authenticated by the
// HmacSHA256 `nomba-signature`. Acknowledges fast; idempotent on transactionId.
@Controller('webhooks')
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly nomba: NombaService,
    private readonly payments: PaymentsService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  @Post('nomba')
  @HttpCode(HttpStatus.OK)
  @ApiExcludeEndpoint()
  async handle(
    @Body() payload: any,
    @Headers('nomba-signature') signature: string,
    @Headers('nomba-timestamp') nombaTimestamp: string,
  ) {
    // TEMP debug: dump the raw payload + headers before verification so we can
    // see the real Nomba shape even if the signature check fails. Remove once
    // the transaction/reversal field shapes are confirmed.
    this.logger.log(`🔔 Nomba webhook received:\n${JSON.stringify(payload, null, 2)}`);
    const verified = this.nomba.verifyWebhookSignature(payload, signature, nombaTimestamp);
    this.logger.log(
      `Signature check: ${verified ? 'PASS' : 'FAIL'} (sig=${signature ? 'present' : 'missing'}, ts=${nombaTimestamp ?? 'missing'})`,
    );
    if (!verified) {
      throw new UnauthorizedException('Invalid signature');
    }
    try {
      await this.dispatch(payload);
    } catch (err) {
      // Surface the failure as a 500 so Nomba redelivers. The ingest path is
      // idempotent on transactionId, so a retry can never double-credit.
      // Permanent problems (malformed/absent data) are handled inside dispatch by
      // returning early rather than throwing, so they don't trigger a retry loop.
      this.logger.error('Webhook processing failed — returning 500 for Nomba retry', err as Error);
      throw err;
    }
    return { received: true };
  }

  private async dispatch(payload: any) {
    const eventType: string = payload?.event_type;
    const tx = payload?.data?.transaction ?? {};

    if (eventType === 'payment_success') {
      const customer = payload?.data?.customer ?? {};
      const amountNaira = Number(tx.transactionAmount);
      if (!tx.transactionId || !Number.isFinite(amountNaira) || amountNaira <= 0) {
        // Correctly signed but unusable — drop it instead of retrying forever.
        this.logger.warn(
          `Ignoring payment_success with invalid ref/amount: ref=${tx.transactionId} amount=${tx.transactionAmount}`,
        );
        return;
      }
      await this.payments.ingestInboundPayment({
        nombaTxnRef: tx.transactionId,
        accountRef: tx.aliasAccountReference ?? null,
        accountNumber: tx.aliasAccountNumber ?? null,
        amountKobo: nairaToKobo(amountNaira),
        sourceName: customer.senderName ?? 'Unknown sender',
        sourceAccount: customer.accountNumber ?? null,
        receivedAt: tx.time ? new Date(tx.time).getTime() : Date.now(),
        rawPayload: payload,
      });
      return;
    }

    if (eventType === 'payment_reversal') {
      // The field linking a reversal to its original payment is unverified — try
      // the likely candidates; reverseInboundPayment logs if none match.
      await this.payments.reverseInboundPayment([
        tx.originalTransactionId,
        tx.parentTransactionId,
        tx.transactionId,
        tx.merchantTxRef,
      ]);
      return;
    }

    if (eventType === 'payout_success' || eventType === 'payout_failed' || eventType === 'payout_refund') {
      const status =
        eventType === 'payout_success'
          ? PayoutStatus.SUCCESS
          : eventType === 'payout_refund'
            ? PayoutStatus.REVERSED
            : PayoutStatus.FAILED;
      const payout = await this.prisma.payout.findFirst({
        where: { OR: [{ nombaTxnRef: tx.transactionId }, { merchantTxRef: tx.merchantTxRef ?? '' }] },
      });
      if (payout) {
        await this.prisma.payout.update({ where: { id: payout.id }, data: { status } });
        this.realtime.broadcast(payout.estateId, 'payout');
      }
      return;
    }

    // payment_failed — the payment never settled, so there's nothing to undo.
    this.logger.log(`Unhandled webhook event_type=${eventType}`);
  }
}
