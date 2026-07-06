import { Injectable } from '@nestjs/common';
import { Observable, Subject } from 'rxjs';

export interface EstateEvent {
  type: string;
  at: number;
}

// In-process pub/sub for real-time dashboard updates (PRD §11). Services call
// broadcast() after a change; the SSE controller subscribes per estate and the
// client invalidates its cached queries.
@Injectable()
export class RealtimeService {
  private readonly subjects = new Map<string, Subject<EstateEvent>>();

  private subjectFor(estateId: string): Subject<EstateEvent> {
    let subject = this.subjects.get(estateId);
    if (!subject) {
      subject = new Subject<EstateEvent>();
      this.subjects.set(estateId, subject);
    }
    return subject;
  }

  broadcast(estateId: string, type: string): void {
    this.subjectFor(estateId).next({ type, at: Date.now() });
  }

  stream(estateId: string): Observable<EstateEvent> {
    return this.subjectFor(estateId).asObservable();
  }
}
