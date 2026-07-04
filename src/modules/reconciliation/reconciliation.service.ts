import { Injectable } from '@nestjs/common';
import {
  reconcile,
  agingBucket,
  sendersDiffer,
  type ReconInput,
  type ReconResult,
  type AgingBucket,
} from './reconciliation';

/**
 * Thin injectable wrapper around the pure reconciliation engine so the rest of
 * the app depends on it via Nest DI. All logic lives in ./reconciliation.ts.
 */
@Injectable()
export class ReconciliationService {
  reconcile(input: ReconInput): ReconResult {
    return reconcile(input);
  }

  agingBucket(dueDate: number, asOf: number): AgingBucket {
    return agingBucket(dueDate, asOf);
  }

  sendersDiffer(a: string, b: string): boolean {
    return sendersDiffer(a, b);
  }
}
