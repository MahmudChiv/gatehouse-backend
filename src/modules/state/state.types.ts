// The naira-denominated view-model the frontend renders. Mirrors the frontend's
// src/lib/types.ts so GET /estate/:id/state feeds the existing UI unchanged.

export type UnitStatus = 'paid' | 'partial' | 'overdue' | 'unbilled' | 'credit';
export type PaymentStatus = 'matched' | 'partial' | 'overpayment' | 'exception' | 'manual' | 'reversed';
export type ExceptionType = 'overpayment' | 'duplicate' | 'misdirected' | 'third_party' | 'reversal';

export interface Charge {
  id: string;
  description: string;
  amount: number;
  paid: number;
  createdAt: number;
  dueAt: number;
  cycle: string;
  kind: 'service' | 'levy';
}

export interface LedgerEntry {
  id: string;
  date: number;
  description: string;
  kind: 'charge' | 'payment' | 'credit';
  amount: number;
  running: number;
  allocation?: string;
  // Settlement of THIS charge (charge rows only) — drives the ledger's paid column.
  settled?: 'paid' | 'partial' | 'unpaid';
}

export interface Unit {
  id: string;
  label: string;
  block: string;
  groupId: string | null;
  occupant: string;
  phone: string;
  email: string;
  accountNumber: string;
  occupantType: 'owner' | 'tenant';
  balance: number;
  credit: number;
  status: UnitStatus;
  lastPaymentAt?: number;
  charges: Charge[];
  ledger: LedgerEntry[];
}

export interface Payment {
  id: string;
  unitId: string | null;
  amount: number;
  timestamp: number;
  sender: string;
  status: PaymentStatus;
  allocation: string;
  exceptionType?: ExceptionType;
}

export interface ExceptionItem {
  id: string;
  paymentId: string;
  type: ExceptionType;
  suggestion: string;
  candidateUnitId?: string;
}

export interface Vendor {
  id: string;
  name: string;
  category: string;
  bank: string;
  bankCode: string;
  account: string;
  totalPaid: number;
}

export interface Payout {
  id: string;
  vendorId: string;
  vendorName: string;
  amount: number;
  note: string;
  date: number;
  status: 'pending' | 'success' | 'failed' | 'reversed';
}

export interface ActivityItem {
  id: string;
  timestamp: number;
  message: string;
  unitId?: string;
}

export interface GroupView {
  id: string;
  name: string;
}

export interface BillingRunView {
  id: string;
  cycle: string;
  chargeAmount: number;
  unitsBilled: number;
  total: number;
  collected: number;
  createdAt: number;
}

export interface LevyView {
  id: string;
  name: string;
  amount: number;
  dueDate: number;
  unitsBilled: number;
  total: number;
  collected: number;
  requireExact: boolean;
}

export interface State {
  estate: { id: string; name: string; address: string; city: string };
  cycle: string;
  allocationRule: 'OLDEST_FIRST' | 'DUES_FIRST';
  units: Unit[];
  payments: Payment[];
  exceptions: ExceptionItem[];
  vendors: Vendor[];
  payouts: Payout[];
  billingRuns: BillingRunView[];
  levies: LevyView[];
  activity: ActivityItem[];
  groups: GroupView[];
  recentlyChanged: Record<string, number>;
}
