// Shared domain helpers for the reconciliation layer.
import { UnitStatus, ChargeStatus, FeeType } from '@prisma/client';
import type { ChargeKind } from '../modules/reconciliation/reconciliation';

/** Map a persisted charge source (FeeType) to the engine's ChargeKind. */
export function chargeKind(sourceType: FeeType): ChargeKind {
  return sourceType === FeeType.service_fee ? 'SERVICE_CHARGE' : 'LEVY';
}

export function deriveUnitStatus(
  balanceKobo: number,
  creditKobo: number,
  totalOriginalKobo: number,
): UnitStatus {
  if (totalOriginalKobo <= 0) return creditKobo > 0 ? UnitStatus.CREDIT : UnitStatus.UNBILLED;
  if (balanceKobo <= 0) return creditKobo > 0 ? UnitStatus.CREDIT : UnitStatus.PAID;
  if (balanceKobo >= totalOriginalKobo) return UnitStatus.OVERDUE;
  return UnitStatus.PARTIAL;
}

export function chargeStatusFor(outstandingKobo: number, originalKobo: number): ChargeStatus {
  if (outstandingKobo <= 0) return ChargeStatus.SETTLED;
  if (outstandingKobo < originalKobo) return ChargeStatus.PARTIAL;
  return ChargeStatus.OPEN;
}
