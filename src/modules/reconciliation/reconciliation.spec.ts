import {
  reconcile,
  sendersDiffer,
  agingBucket,
  type ReconInput,
  type ReconCharge,
} from './reconciliation';

const NOW = 1_720_000_000_000;
const NGN = (naira: number) => naira * 100; // kobo

function charge(over: Partial<ReconCharge> = {}): ReconCharge {
  return {
    id: over.id ?? 'chg_service',
    kind: over.kind ?? 'SERVICE_CHARGE',
    outstandingKobo: over.outstandingKobo ?? NGN(45000),
    dueDate: over.dueDate ?? NOW - 5 * 86_400_000,
  };
}

function input(over: Partial<ReconInput> = {}): ReconInput {
  return {
    payment: { amountKobo: NGN(45000), receivedAt: NOW, sourceName: 'Ada Okafor' },
    charges: [charge()],
    creditBalanceKobo: 0,
    occupantName: 'Ada Okafor',
    rule: 'OLDEST_FIRST',
    autoCreditThresholdKobo: NGN(5000),
    duplicateWindowSecs: 900,
    priorPayments: [],
    unitMatched: true,
    ...over,
  };
}

describe('reconcile — core cases (PRD §6.3)', () => {
  it('exact payment settles the charge and marks MATCHED', () => {
    const r = reconcile(input());
    expect(r.status).toBe('MATCHED');
    expect(r.isException).toBe(false);
    expect(r.allocations).toEqual([
      { chargeId: 'chg_service', amountKobo: NGN(45000), fromCreditKobo: 0 },
    ]);
    expect(r.newCreditBalanceKobo).toBe(0);
    expect(r.reminderNeeded).toBe(false);
  });

  it('underpayment allocates what it can, leaves outstanding, flags PARTIAL + reminder', () => {
    const r = reconcile(input({ payment: { amountKobo: NGN(20000), receivedAt: NOW, sourceName: 'Ada Okafor' } }));
    expect(r.status).toBe('PARTIAL');
    expect(r.reminderNeeded).toBe(true);
    expect(r.allocations[0].amountKobo).toBe(NGN(20000));
  });

  it('overpayment within threshold auto-credits the surplus (OVERPAYMENT, not an exception)', () => {
    const r = reconcile(
      input({
        payment: { amountKobo: NGN(50000), receivedAt: NOW, sourceName: 'Ada Okafor' },
        autoCreditThresholdKobo: NGN(5000),
      }),
    );
    expect(r.status).toBe('OVERPAYMENT');
    expect(r.isException).toBe(false);
    expect(r.creditAddedKobo).toBe(NGN(5000));
    expect(r.newCreditBalanceKobo).toBe(NGN(5000));
  });

  it('overpayment beyond threshold settles charges but raises an OVERPAYMENT exception with surplus held', () => {
    const r = reconcile(
      input({
        payment: { amountKobo: NGN(55000), receivedAt: NOW, sourceName: 'Ada Okafor' },
        autoCreditThresholdKobo: NGN(5000),
      }),
    );
    expect(r.status).toBe('EXCEPTION');
    expect(r.isException).toBe(true);
    expect(r.exceptionType).toBe('OVERPAYMENT');
    expect(r.allocations[0].amountKobo).toBe(NGN(45000)); // charge still settled
    expect(r.creditAddedKobo).toBe(0); // surplus NOT credited yet
    expect(r.newCreditBalanceKobo).toBe(0);
  });

  it('split payments accumulate: two partials settle one charge', () => {
    const first = reconcile(input({ payment: { amountKobo: NGN(20000), receivedAt: NOW, sourceName: 'Ada Okafor' } }));
    expect(first.status).toBe('PARTIAL');
    const second = reconcile(
      input({
        charges: [charge({ outstandingKobo: NGN(25000) })],
        payment: { amountKobo: NGN(25000), receivedAt: NOW + 1000, sourceName: 'Ada Okafor' },
      }),
    );
    expect(second.status).toBe('MATCHED');
  });

  it('applies existing credit before the new payment', () => {
    const r = reconcile(
      input({
        creditBalanceKobo: NGN(20000),
        payment: { amountKobo: NGN(25000), receivedAt: NOW, sourceName: 'Ada Okafor' },
      }),
    );
    expect(r.status).toBe('MATCHED');
    expect(r.creditAppliedKobo).toBe(NGN(20000));
    expect(r.allocations[0]).toEqual({
      chargeId: 'chg_service',
      amountKobo: NGN(25000),
      fromCreditKobo: NGN(20000),
    });
    expect(r.newCreditBalanceKobo).toBe(0);
  });

  it('credit covers the charge and the new payment becomes credit', () => {
    const r = reconcile(
      input({
        creditBalanceKobo: NGN(45000),
        payment: { amountKobo: NGN(10000), receivedAt: NOW, sourceName: 'Ada Okafor' },
        autoCreditThresholdKobo: NGN(20000),
      }),
    );
    expect(r.status).toBe('OVERPAYMENT');
    expect(r.creditAppliedKobo).toBe(NGN(45000));
    expect(r.creditAddedKobo).toBe(NGN(10000));
    expect(r.newCreditBalanceKobo).toBe(NGN(10000));
  });
});

describe('reconcile — allocation ordering (PRD §6.2)', () => {
  const older = charge({ id: 'old', dueDate: NOW - 40 * 86_400_000, outstandingKobo: NGN(45000), kind: 'SERVICE_CHARGE' });
  const newerLevy = charge({ id: 'levy', dueDate: NOW - 10 * 86_400_000, outstandingKobo: NGN(10000), kind: 'LEVY' });

  it('OLDEST_FIRST fills the earliest-due charge first', () => {
    const r = reconcile(
      input({
        charges: [newerLevy, older],
        rule: 'OLDEST_FIRST',
        payment: { amountKobo: NGN(45000), receivedAt: NOW, sourceName: 'Ada Okafor' },
      }),
    );
    expect(r.allocations[0].chargeId).toBe('old');
  });

  it('DUES_FIRST prioritises service charges over levies regardless of due date', () => {
    const serviceLater = charge({ id: 'svc', dueDate: NOW - 1 * 86_400_000, kind: 'SERVICE_CHARGE', outstandingKobo: NGN(45000) });
    const levyEarlier = charge({ id: 'levy', dueDate: NOW - 30 * 86_400_000, kind: 'LEVY', outstandingKobo: NGN(10000) });
    const r = reconcile(
      input({
        charges: [levyEarlier, serviceLater],
        rule: 'DUES_FIRST',
        payment: { amountKobo: NGN(10000), receivedAt: NOW, sourceName: 'Ada Okafor' },
      }),
    );
    expect(r.allocations[0].chargeId).toBe('svc');
  });
});

describe('reconcile — exception classification (PRD §6.4)', () => {
  it('misdirected when no unit owns the receiving account', () => {
    const r = reconcile(input({ unitMatched: false }));
    expect(r.status).toBe('EXCEPTION');
    expect(r.exceptionType).toBe('MISDIRECTED');
    expect(r.allocations).toHaveLength(0);
  });

  it('duplicate: same amount + sender within the window', () => {
    const r = reconcile(
      input({
        priorPayments: [{ amountKobo: NGN(45000), sourceName: 'Ada Okafor', receivedAt: NOW - 300_000 }],
      }),
    );
    expect(r.exceptionType).toBe('DUPLICATE');
  });

  it('not a duplicate when outside the window', () => {
    const r = reconcile(
      input({
        priorPayments: [{ amountKobo: NGN(45000), sourceName: 'Ada Okafor', receivedAt: NOW - 2 * 3600_000 }],
      }),
    );
    expect(r.status).toBe('MATCHED');
  });

  it('third-party: sender differs materially from the occupant, tagged paid on behalf', () => {
    const r = reconcile(input({ payment: { amountKobo: NGN(45000), receivedAt: NOW, sourceName: 'Stephen Adewale (father)' }, occupantName: 'Uche Obi' }));
    expect(r.exceptionType).toBe('THIRD_PARTY');
    expect(r.tag).toBe('Paid on behalf');
    expect(r.allocations).toHaveLength(0);
  });

  it('forceApply skips duplicate/third-party checks and allocates (exception resolution path)', () => {
    const r = reconcile(
      input({
        forceApply: true,
        payment: { amountKobo: NGN(45000), receivedAt: NOW, sourceName: 'Stephen Adewale (father)' },
        occupantName: 'Uche Obi',
      }),
    );
    expect(r.status).toBe('MATCHED');
    expect(r.allocations[0].amountKobo).toBe(NGN(45000));
  });

  it('payment into a unit with no open charge routes to overpayment handling', () => {
    const held = reconcile(input({ charges: [], payment: { amountKobo: NGN(20000), receivedAt: NOW, sourceName: 'Ada Okafor' }, autoCreditThresholdKobo: NGN(5000) }));
    expect(held.exceptionType).toBe('OVERPAYMENT');
    const credited = reconcile(input({ charges: [], payment: { amountKobo: NGN(20000), receivedAt: NOW, sourceName: 'Ada Okafor' }, autoCreditThresholdKobo: NGN(50000) }));
    expect(credited.status).toBe('OVERPAYMENT');
    expect(credited.creditAddedKobo).toBe(NGN(20000));
  });
});

describe('reconcile — determinism / idempotency (PRD §6.5)', () => {
  it('produces an identical result when re-run on the same input', () => {
    const a = reconcile(input());
    const b = reconcile(input());
    expect(a).toEqual(b);
  });
});

describe('helpers', () => {
  it('sendersDiffer detects material differences but tolerates shared tokens', () => {
    expect(sendersDiffer('Stephen Adewale (father)', 'Uche Obi')).toBe(true);
    expect(sendersDiffer('Ada Okafor', 'Ada Okafor')).toBe(false);
    expect(sendersDiffer('Mr Ada Okafor', 'Ada Okafor')).toBe(false);
    expect(sendersDiffer('', 'Ada')).toBe(false);
  });

  it('agingBucket classifies days past due', () => {
    expect(agingBucket(NOW - 10 * 86_400_000, NOW)).toBe('0-30');
    expect(agingBucket(NOW - 45 * 86_400_000, NOW)).toBe('31-60');
    expect(agingBucket(NOW - 75 * 86_400_000, NOW)).toBe('61-90');
    expect(agingBucket(NOW - 120 * 86_400_000, NOW)).toBe('90+');
  });
});
