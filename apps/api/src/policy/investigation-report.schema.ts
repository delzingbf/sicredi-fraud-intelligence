import { z } from 'zod';
import type { InvestigationReport } from '@fraud-intelligence/contracts';

/**
 * Zod schema that mirrors InvestigationReport from packages/contracts.
 *
 * Includes semantic invariants via .superRefine() so that structurally valid
 * but logically incoherent reports are rejected and fall back to INCONCLUSIVE,
 * rather than reaching the client with contradictory fields.
 *
 * Compile-time bidirectional type guard at the bottom ensures this schema
 * stays in sync with the shared contract type in both directions.
 */
export const investigationReportSchema = z
  .object({
    schemaVersion: z.literal('1.0'),
    transactionId: z.string().min(1),
    riskLevel: z.enum(['LOW_RISK', 'SUSPICIOUS', 'HIGH_RISK', 'INCONCLUSIVE']),
    recommendedAction: z.enum([
      'PROCEED',
      'REQUEST_MEMBER_VERIFICATION',
      'MANUAL_REVIEW',
    ]),
    toolsExecuted: z.array(z.string()),
    evidenceFor: z.array(z.string()),
    evidenceAgainst: z.array(z.string()),
    missingInformation: z.array(z.string()),
    contradictions: z.array(z.string()),
    explanation: z.string().min(1),
    requiresHumanReview: z.boolean(),
    confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  })
  .superRefine((report, ctx) => {
    // Rule: REQUEST_MEMBER_VERIFICATION requires elevated risk
    if (
      report.recommendedAction === 'REQUEST_MEMBER_VERIFICATION' &&
      report.riskLevel !== 'HIGH_RISK' &&
      report.riskLevel !== 'SUSPICIOUS'
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recommendedAction'],
        message:
          'REQUEST_MEMBER_VERIFICATION requires riskLevel HIGH_RISK or SUSPICIOUS',
      });
    }

    // Rule: only LOW_RISK may recommend PROCEED
    if (report.recommendedAction === 'PROCEED' && report.riskLevel !== 'LOW_RISK') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recommendedAction'],
        message: `${report.riskLevel} cannot recommend PROCEED`,
      });
    }

    // Rule: INCONCLUSIVE always requires human review
    if (report.riskLevel === 'INCONCLUSIVE' && !report.requiresHumanReview) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requiresHumanReview'],
        message: 'INCONCLUSIVE must set requiresHumanReview to true',
      });
    }

    // Rule: HIGH_RISK with HIGH confidence must have at least one evidence item
    if (
      report.riskLevel === 'HIGH_RISK' &&
      report.confidence === 'HIGH' &&
      report.evidenceFor.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidenceFor'],
        message: 'HIGH_RISK with HIGH confidence must provide at least one evidenceFor item',
      });
    }
  });

export type ValidatedReport = z.infer<typeof investigationReportSchema>;

// ─── Bidirectional compile-time type guard ────────────────────────────────────
// Both assignments must compile. Catches new required fields and changed union
// values in either direction. A new *optional* field in contracts is NOT caught —
// add it here in the same commit (ADR-005).

// Direction 1: Zod output must be assignable to the contracts type
const _zodToContract = (_r: ValidatedReport): InvestigationReport => _r;
void _zodToContract;

// Direction 2: contracts type must be assignable to the Zod inferred type
const _contractToZod = (_r: InvestigationReport): ValidatedReport => _r;
void _contractToZod;
