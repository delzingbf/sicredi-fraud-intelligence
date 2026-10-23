import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  VerificationDecision,
  VerificationRecord,
} from '@fraud-intelligence/contracts';
import { PolicyService } from '../policy/policy.service.js';
import { InvestigationStore, type InvestigationEntry } from './investigation.store.js';

/**
 * VerificationService — simulated member verification (no real SMS/push).
 *
 * Lifecycle per investigation (at most one request each):
 *   request  → PENDING      (only if PolicyService allows it for the stored report)
 *   confirm  → CONFIRMED | DENIED
 *
 * The gate always runs on the report stored by InvestigationService. The client
 * only sends an investigationId, so it cannot supply or alter the report.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    private readonly store: InvestigationStore,
    private readonly policyService: PolicyService,
  ) {}

  /**
   * Opens a PENDING verification for a stored investigation.
   *   404 — unknown investigationId
   *   409 — a verification already exists (pending or resolved)
   *   403 — the stored report does not pass the policy gate
   */
  requestVerification(investigationId: string): VerificationRecord {
    const entry = this.findEntry(investigationId);

    if (entry.verification) {
      throw new ConflictException(
        `Verification for investigation ${investigationId} is already ${entry.verification.status}`,
      );
    }

    if (!this.policyService.canRequestMemberVerification(entry.report)) {
      throw new ForbiddenException(
        `Verification not permitted for riskLevel=${entry.report.riskLevel} / ` +
          `recommendedAction=${entry.report.recommendedAction}`,
      );
    }

    const record: VerificationRecord = {
      investigationId,
      transactionId: entry.report.transactionId,
      status: 'PENDING',
      requestedAt: new Date().toISOString(),
    };
    this.store.setVerification(investigationId, record);
    this.logger.log(
      `Verification requested for investigation ${investigationId} / tx ${record.transactionId}`,
    );
    return record;
  }

  /**
   * Records the associate's decision for a PENDING verification.
   *   404 — unknown investigationId or no verification requested
   *   409 — verification already resolved
   */
  confirmVerification(
    investigationId: string,
    decision: VerificationDecision,
  ): VerificationRecord {
    const current = this.getVerification(investigationId);

    if (current.status !== 'PENDING') {
      throw new ConflictException(
        `Verification for investigation ${investigationId} is already ${current.status}`,
      );
    }

    const updated: VerificationRecord = {
      ...current,
      status: decision,
      resolvedAt: new Date().toISOString(),
    };
    this.store.setVerification(investigationId, updated);
    this.logger.log(`Verification ${decision} for investigation ${investigationId}`);
    return updated;
  }

  /** Current verification state. 404 if the investigation or its verification does not exist. */
  getVerification(investigationId: string): VerificationRecord {
    const { verification } = this.findEntry(investigationId);
    if (!verification) {
      throw new NotFoundException(
        `No verification requested for investigation ${investigationId}`,
      );
    }
    return verification;
  }

  private findEntry(investigationId: string): InvestigationEntry {
    const entry = this.store.find(investigationId);
    if (!entry) {
      throw new NotFoundException(`Investigation ${investigationId} not found`);
    }
    return entry;
  }
}
