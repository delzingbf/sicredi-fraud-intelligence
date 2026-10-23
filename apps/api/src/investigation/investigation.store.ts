import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type {
  InvestigationReport,
  VerificationRecord,
} from '@fraud-intelligence/contracts';

/** Upper bound on kept investigations; the oldest entry is evicted first. */
const MAX_ENTRIES = 1_000;

export interface InvestigationEntry {
  report: InvestigationReport;
  verification?: VerificationRecord;
}

/**
 * InvestigationStore — server-side record of completed investigations.
 *
 * The member-verification endpoints look reports up here by investigationId,
 * so the policy gate always evaluates the report the backend produced and
 * never one supplied by the client.
 *
 * In-memory and bounded for the MVP. Swap for a TypeORM repository once the
 * database layer (Sub-Task 3) exists; the public methods stay the same.
 */
@Injectable()
export class InvestigationStore {
  private readonly entries = new Map<string, InvestigationEntry>();

  /** Stores a report and returns its new investigationId (UUID v4). */
  create(report: InvestigationReport): string {
    const investigationId = randomUUID();
    this.entries.set(investigationId, { report });

    // Map iterates in insertion order, so the first key is the oldest.
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }

    return investigationId;
  }

  find(investigationId: string): InvestigationEntry | undefined {
    return this.entries.get(investigationId);
  }

  setVerification(investigationId: string, record: VerificationRecord): void {
    const entry = this.entries.get(investigationId);
    if (entry) entry.verification = record;
  }
}
