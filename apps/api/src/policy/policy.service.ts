import { Injectable } from '@nestjs/common';
import type { InvestigationReport } from '@fraud-intelligence/contracts';
import { formatZodIssues } from '../common/zod/format-zod-issues.js';
import { investigationReportSchema } from './investigation-report.schema.js';

/** Discriminated union returned by validate() — no thrown exceptions. */
export type ValidationResult =
  | { ok: true; report: InvestigationReport }
  | { ok: false; issues: string[] };

/**
 * PolicyService — deterministic safety layer.
 *
 * Responsibilities:
 *   1. validate()                     — Zod schema + semantic invariants on the
 *                                       agent's raw output. Never throws.
 *   2. canRequestMemberVerification() — gate used by VerificationService on the
 *                                       report stored server-side, after the
 *                                       agent loop has finished.
 *
 * This service contains NO AI logic. Every decision is a deterministic rule.
 * requestMemberVerification is not a tool the LLM can call during the loop; it
 * is a post-investigation action triggered through the verification endpoints.
 */
@Injectable()
export class PolicyService {
  /**
   * Validates raw agent output.
   * Returns { ok: true, report } on success or { ok: false, issues } on failure.
   * Never throws — callers use the discriminated union directly.
   */
  validate(raw: unknown): ValidationResult {
    const result = investigationReportSchema.safeParse(raw);

    if (!result.success) {
      return { ok: false, issues: formatZodIssues(result.error) };
    }

    return { ok: true, report: result.data };
  }

  /**
   * Returns true only when a validated report justifies a member verification
   * request. Called by VerificationService with the report stored for the
   * investigation — never with a report supplied by the client.
   *
   * Rules:
   *   - riskLevel must be HIGH_RISK or SUSPICIOUS
   *   - recommendedAction must be REQUEST_MEMBER_VERIFICATION
   *
   * INCONCLUSIVE and LOW_RISK are always blocked.
   */
  canRequestMemberVerification(report: InvestigationReport): boolean {
    return (
      (report.riskLevel === 'HIGH_RISK' || report.riskLevel === 'SUSPICIOUS') &&
      report.recommendedAction === 'REQUEST_MEMBER_VERIFICATION'
    );
  }
}
