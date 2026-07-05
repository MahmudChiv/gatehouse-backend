/**
 * Gatehouse reconciliation engine — the scored centrepiece (PRD §6).
 *
 * Pure, framework-agnostic, and deterministic: given the same inputs it always
 * produces the same allocations and status, so a re-delivered webhook re-run on
 * the same data yields an identical result. All money is integer kobo.
 *
 * Idempotency at the storage layer (dedupe on Nomba's transaction reference) is
 * enforced by the ingest handler before this function is ever called; this module
 * is concerned purely with *how* a payment is allocated.
 */
import { formatNaira } from '../../common/money';

export type AllocationRule = 'OLDEST_FIRST' | 'DUES_FIRST';
export type ChargeKind = 'SERVICE_CHARGE' | 'LEVY';
export type ReconExceptionType =
  | 'OVERPAYMENT'
  | 'DUPLICATE'
  | 'MISDIRECTED'
  | 'THIRD_PARTY';
export type PaymentOutcome = 'MATCHED' | 'PARTIAL' | 'OVERPAYMENT' | 'EXCEPTION';

export interface ReconCharge {
  id: string;
  kind: ChargeKind;
  outstandingKobo: number;
  dueDate: number; // epoch ms
}

export interface ReconPayment {
  amountKobo: number;
  receivedAt: number; // epoch ms
  sourceName: string;
}

/** A prior payment on the same unit, used only for duplicate detection. */
export interface PriorPayment {
  amountKobo: number;
  sourceName: string;
  receivedAt: number; // epoch ms
}

export interface ReconInput {
  payment: ReconPayment;
  charges: ReconCharge[]; // the unit's currently open charges
  creditBalanceKobo: number; // the unit's existing credit
  occupantName: string;
  rule: AllocationRule;
  autoCreditThresholdKobo: number; // surplus strictly greater than this raises an exception
  duplicateWindowSecs: number;
  priorPayments: PriorPayment[];
  /** false when no unit owns the receiving account (misdirected). */
  unitMatched: boolean;
  /**
   * When true (e.g. the manager confirms a held payment while resolving an
   * exception), skip duplicate/third-party detection and allocate normally.
   */
  forceApply?: boolean;
}

export interface ChargeAllocation {
  chargeId: string;
  amountKobo: number; // funded by the incoming payment
  fromCreditKobo: number; // funded by pre-existing credit
}

export interface ReconResult {
  status: PaymentOutcome;
  allocations: ChargeAllocation[];
  creditAppliedKobo: number; // existing credit consumed
  creditAddedKobo: number; // surplus moved to credit (0 while held as an exception)
  newCreditBalanceKobo: number;
  isException: boolean;
  exceptionType?: ReconExceptionType;
  suggestion?: string;
  reminderNeeded: boolean; // true on underpayment/partial
  tag?: string; // e.g. "Paid on behalf"
}

// ---------- helpers ----------

function sortCharges(charges: ReconCharge[], rule: AllocationRule): ReconCharge[] {
  const byOldest = (a: ReconCharge, b: ReconCharge) =>
    a.dueDate - b.dueDate || a.id.localeCompare(b.id);
  if (rule === 'DUES_FIRST') {
    const rank = (c: ReconCharge) => (c.kind === 'SERVICE_CHARGE' ? 0 : 1);
    return [...charges].sort((a, b) => rank(a) - rank(b) || byOldest(a, b));
  }
  return [...charges].sort(byOldest);
}

/** Normalise a name into comparable lowercase alphabetic tokens. */
function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ') // drop parentheticals like "(father)"
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/** True when two names share no token — treated as a materially different sender. */
export function sendersDiffer(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false; // unknown → don't over-flag
  return !ta.some((t) => tb.includes(t));
}

function isDuplicate(input: ReconInput): boolean {
  const { payment, priorPayments, duplicateWindowSecs } = input;
  const windowMs = duplicateWindowSecs * 1000;
  return priorPayments.some(
    (p) =>
      p.amountKobo === payment.amountKobo &&
      p.sourceName.trim().toLowerCase() ===
        payment.sourceName.trim().toLowerCase() &&
      Math.abs(payment.receivedAt - p.receivedAt) <= windowMs,
  );
}

export type AgingBucket = '0-30' | '31-60' | '61-90' | '90+';

/** Arrears aging bucket for an outstanding charge (PRD §6.3). */
export function agingBucket(dueDate: number, asOf: number): AgingBucket {
  const days = Math.floor((asOf - dueDate) / 86_400_000);
  if (days <= 30) return '0-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

// ---------- engine ----------

export function reconcile(input: ReconInput): ReconResult {
  const { payment, creditBalanceKobo } = input;

  const base: ReconResult = {
    status: 'EXCEPTION',
    allocations: [],
    creditAppliedKobo: 0,
    creditAddedKobo: 0,
    newCreditBalanceKobo: creditBalanceKobo,
    isException: false,
    reminderNeeded: false,
  };

  // 1. Misdirected: the receiving account maps to no unit / no open charge to apply to.
  if (!input.unitMatched) {
    return {
      ...base,
      isException: true,
      exceptionType: 'MISDIRECTED',
      suggestion:
        'No unit matched the receiving account — reassign to the correct unit.',
    };
  }

  if (!input.forceApply) {
    // 2. Duplicate: same amount + sender on this unit within the window.
    if (isDuplicate(input)) {
      return {
        ...base,
        isException: true,
        exceptionType: 'DUPLICATE',
        suggestion:
          'Same amount from the same sender within the duplicate window — hold for confirmation.',
      };
    }

    // 3. Third-party / on-behalf: sender name differs materially from the occupant.
    if (sendersDiffer(payment.sourceName, input.occupantName)) {
      return {
        ...base,
        isException: true,
        exceptionType: 'THIRD_PARTY',
        suggestion: `Sender "${payment.sourceName}" does not match the occupant — attribute and tag as paid on behalf.`,
        tag: 'Paid on behalf',
      };
    }
  }

  // 4. Allocate. Apply existing credit first, then the incoming payment,
  //    across charges ordered by the estate's rule (PRD §6.2, §6.3).
  const ordered = sortCharges(
    input.charges.filter((c) => c.outstandingKobo > 0),
    input.rule,
  );
  const totalOutstandingBefore = ordered.reduce(
    (a, c) => a + c.outstandingKobo,
    0,
  );

  let remainingCredit = creditBalanceKobo;
  let remainingPayment = payment.amountKobo;
  const allocations: ChargeAllocation[] = [];

  for (const charge of ordered) {
    let owed = charge.outstandingKobo;
    if (owed <= 0) continue;

    const fromCredit = Math.min(remainingCredit, owed);
    remainingCredit -= fromCredit;
    owed -= fromCredit;

    const fromPayment = Math.min(remainingPayment, owed);
    remainingPayment -= fromPayment;
    owed -= fromPayment;

    if (fromCredit > 0 || fromPayment > 0) {
      allocations.push({
        chargeId: charge.id,
        amountKobo: fromPayment,
        fromCreditKobo: fromCredit,
      });
    }
    if (remainingCredit <= 0 && remainingPayment <= 0) break;
  }

  const creditAppliedKobo = creditBalanceKobo - remainingCredit;
  const surplus = remainingPayment; // payment left after all charges settled
  const outstandingAfter =
    totalOutstandingBefore -
    creditAppliedKobo -
    allocations.reduce((a, x) => a + x.amountKobo, 0);

  // 5. Classify outcome.
  if (surplus > 0) {
    const overThreshold = surplus > input.autoCreditThresholdKobo;
    if (overThreshold) {
      // Hold the surplus for a credit-or-refund decision; charges are still settled.
      return {
        ...base,
        status: 'EXCEPTION',
        allocations,
        creditAppliedKobo,
        creditAddedKobo: 0,
        newCreditBalanceKobo: remainingCredit, // surplus NOT yet credited
        isException: true,
        exceptionType: 'OVERPAYMENT',
        suggestion: `Overpayment of ${formatNaira(surplus)} beyond outstanding — move to credit or flag for refund.`,
      };
    }
    // Auto-credit the surplus (default behaviour).
    return {
      ...base,
      status: 'OVERPAYMENT',
      allocations,
      creditAppliedKobo,
      creditAddedKobo: surplus,
      newCreditBalanceKobo: remainingCredit + surplus,
      isException: false,
    };
  }

  if (outstandingAfter > 0) {
    // Underpayment: some charges remain outstanding; schedule a reminder.
    return {
      ...base,
      status: 'PARTIAL',
      allocations,
      creditAppliedKobo,
      newCreditBalanceKobo: remainingCredit,
      reminderNeeded: true,
    };
  }

  // Exact settlement.
  return {
    ...base,
    status: 'MATCHED',
    allocations,
    creditAppliedKobo,
    newCreditBalanceKobo: remainingCredit,
  };
}
