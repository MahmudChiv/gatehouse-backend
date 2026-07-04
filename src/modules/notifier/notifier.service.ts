import { Injectable, Logger } from '@nestjs/common';
import { formatNaira } from '../../common/money';

// Notification interface, stubbed behind a logger for the hackathon (PRD §11).
// Swap in a real SMS/WhatsApp/email provider by replacing the method bodies.
@Injectable()
export class NotifierService {
  private readonly logger = new Logger(NotifierService.name);

  billIssued(to: { name: string; email?: string }, ctx: { unitLabel: string; amountKobo: number; dueDate: number }) {
    this.logger.log(`BILL → ${to.name} (${to.email ?? 'no email'}): ${ctx.unitLabel} owes ${formatNaira(ctx.amountKobo)}.`);
  }

  receipt(to: { name: string; email?: string }, ctx: { unitLabel: string; amountKobo: number; balanceKobo: number }) {
    this.logger.log(`RECEIPT → ${to.name}: received ${formatNaira(ctx.amountKobo)} for ${ctx.unitLabel}. Balance ${formatNaira(ctx.balanceKobo)}.`);
  }

  arrears(to: { name: string; email?: string }, ctx: { unitLabel: string; outstandingKobo: number }) {
    this.logger.log(`ARREARS → ${to.name}: ${ctx.unitLabel} still owes ${formatNaira(ctx.outstandingKobo)}.`);
  }
}
