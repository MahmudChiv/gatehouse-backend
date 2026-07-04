import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PayoutStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NombaService } from '../nomba/nomba.service';
import { RealtimeService } from '../realtime/realtime.service';
import { koboToNaira, formatNaira } from '../../common/money';

@Injectable()
export class PayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly nomba: NombaService,
    private readonly realtime: RealtimeService,
  ) {}

  async addVendor(
    estateId: string,
    input: { name: string; category: string; bankName: string; bankCode?: string; accountNumber: string },
  ) {
    const vendor = await this.prisma.vendor.create({ data: { estateId, ...input } });
    this.realtime.broadcast(estateId, 'vendor');
    return vendor;
  }

  async payVendor(estateId: string, vendorId: string, amountKobo: number, note: string) {
    const vendor = await this.prisma.vendor.findFirstOrThrow({ where: { id: vendorId, estateId } });
    const estate = await this.prisma.estate.findUniqueOrThrow({ where: { id: estateId } });
    const merchantTxRef = `payout-${randomUUID()}`;

    const payout = await this.prisma.payout.create({
      data: { estateId, vendorId, amountKobo, note, merchantTxRef, status: PayoutStatus.PENDING },
    });

    let status: PayoutStatus = PayoutStatus.PENDING;
    let nombaTxnRef: string | null = null;
    try {
      const result = await this.nomba.transferToBank({
        amountNaira: koboToNaira(amountKobo),
        accountNumber: vendor.accountNumber,
        accountName: vendor.name,
        bankCode: vendor.bankCode ?? '',
        merchantTxRef,
        senderName: estate.name,
        narration: note,
      });
      nombaTxnRef = result.id;
      status = result.status === 'SUCCESS' ? PayoutStatus.SUCCESS : PayoutStatus.PENDING;
    } catch {
      status = PayoutStatus.FAILED;
    }

    await this.prisma.payout.update({ where: { id: payout.id }, data: { status, nombaTxnRef } });
    await this.prisma.activity.create({
      data: { estateId, message: `Paid ${vendor.name} ${formatNaira(amountKobo)} — ${note}${status === PayoutStatus.FAILED ? ' (failed)' : ''}` },
    });
    this.realtime.broadcast(estateId, 'payout');
    return { payoutId: payout.id, status };
  }
}
