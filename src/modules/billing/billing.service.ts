import { Injectable } from '@nestjs/common';
import { ChargeStatus, FeeFrequency, FeeType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotifierService } from '../notifier/notifier.service';
import { RealtimeService } from '../realtime/realtime.service';
import { consumeCreditForUnit } from '../payments/apply';
import { formatNaira } from '../../common/money';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notifier: NotifierService,
    private readonly realtime: RealtimeService,
  ) {}

  private async resolveUnitIds(estateId: string, unitIds?: string[]): Promise<string[]> {
    if (unitIds && unitIds.length) return unitIds;
    const units = await this.prisma.unit.findMany({ where: { estateId, deletedAt: null }, select: { id: true } });
    return units.map((u) => u.id);
  }

  async createBillingRun(
    estateId: string,
    input: { cycleLabel: string; chargeAmountKobo: number; dueDate: number; unitIds?: string[] },
  ) {
    const unitIds = await this.resolveUnitIds(estateId, input.unitIds);
    const dueDate = new Date(input.dueDate);
    const run = await this.prisma.billingRun.create({
      data: {
        estateId,
        cycleLabel: input.cycleLabel,
        chargeAmountKobo: input.chargeAmountKobo,
        unitScope: input.unitIds?.length ? { unitIds } : { all: true },
      },
    });

    const units = await this.prisma.unit.findMany({ where: { id: { in: unitIds } } });
    for (const unit of units) {
      await this.prisma.$transaction(async (tx) => {
        await tx.charge.create({
          data: {
            unitId: unit.id,
            sourceType: FeeType.service_fee,
            billingRunId: run.id,
            description: `Service charge — ${input.cycleLabel}`,
            cycleLabel: input.cycleLabel,
            originalAmountKobo: input.chargeAmountKobo,
            outstandingKobo: input.chargeAmountKobo,
            dueDate,
            status: ChargeStatus.OPEN,
          },
        });
        await consumeCreditForUnit(tx, unit.id);
      });
      this.notifier.billIssued({ name: unit.occupant, email: unit.email }, { unitLabel: unit.unitName, amountKobo: input.chargeAmountKobo, dueDate: input.dueDate });
    }

    await this.prisma.estate.update({ where: { id: estateId }, data: { cycleLabel: input.cycleLabel } });
    await this.prisma.activity.create({
      data: { estateId, message: `Billing run ${input.cycleLabel} — ${units.length} units billed ${formatNaira(input.chargeAmountKobo)}` },
    });
    this.realtime.broadcast(estateId, 'billing');
    return { billingRunId: run.id, unitsBilled: units.length };
  }

  async createLevy(
    estateId: string,
    input: { name: string; amountKobo: number; dueDate: number; requireExact?: boolean; unitIds?: string[] },
  ) {
    const unitIds = await this.resolveUnitIds(estateId, input.unitIds);
    const dueDate = new Date(input.dueDate);
    const fee = await this.prisma.fee.create({
      data: {
        estateId,
        name: input.name,
        type: FeeType.levy,
        amountKobo: input.amountKobo,
        frequency: FeeFrequency.one_time,
        requireExact: input.requireExact ?? false,
        dueDate,
      },
    });

    const units = await this.prisma.unit.findMany({ where: { id: { in: unitIds } } });
    for (const unit of units) {
      await this.prisma.$transaction(async (tx) => {
        await tx.charge.create({
          data: {
            unitId: unit.id,
            sourceType: FeeType.levy,
            feeId: fee.id,
            description: input.name,
            cycleLabel: input.name,
            originalAmountKobo: input.amountKobo,
            outstandingKobo: input.amountKobo,
            dueDate,
            status: ChargeStatus.OPEN,
          },
        });
        await consumeCreditForUnit(tx, unit.id);
      });
      this.notifier.billIssued({ name: unit.occupant, email: unit.email }, { unitLabel: unit.unitName, amountKobo: input.amountKobo, dueDate: input.dueDate });
    }

    await this.prisma.activity.create({
      data: { estateId, message: `Levy "${input.name}" — ${units.length} units billed ${formatNaira(input.amountKobo)}` },
    });
    this.realtime.broadcast(estateId, 'billing');
    // `requireExact` is stored and surfaced in the UI; exactness is enforced in
    // reconciliation logic, not by pinning the unit account's expectedAmount
    // (a unit's single account also collects recurring dues, which allow partials).
    return { levyId: fee.id, unitsBilled: units.length };
  }
}
