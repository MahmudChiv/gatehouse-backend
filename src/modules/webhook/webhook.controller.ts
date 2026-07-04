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
    if (!this.nomba.verifyWebhookSignature(payload, signature, nombaTimestamp)) {
      throw new UnauthorizedException('Invalid signature');
    }
    try {
      await this.dispatch(payload);
    } catch (err) {
      // Acknowledge anyway so Nomba doesn't hammer retries; the error is logged.
      this.logger.error('Webhook processing error', err as Error);
    }
    return { received: true };
  }

  private async dispatch(payload: any) {
    const eventType: string = payload?.event_type;
    const tx = payload?.data?.transaction ?? {};

    if (eventType === 'payment_success') {
      const customer = payload?.data?.customer ?? {};
      await this.payments.ingestInboundPayment({
        nombaTxnRef: tx.transactionId,
        accountRef: tx.aliasAccountReference ?? null,
        accountNumber: tx.aliasAccountNumber ?? null,
        amountKobo: nairaToKobo(Number(tx.transactionAmount)),
        sourceName: customer.senderName ?? 'Unknown sender',
        sourceAccount: customer.accountNumber ?? null,
        receivedAt: tx.time ? new Date(tx.time).getTime() : Date.now(),
        rawPayload: payload,
      });
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

    // payment_failed / payment_reversal — logged; extend as needed.
    this.logger.log(`Unhandled webhook event_type=${eventType}`);
  }
}
