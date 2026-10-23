// TYPES ONLY. This package is consumed straight from source (package.json
// "exports" points at src/index.ts) and every import of it is erased at
// compile time. A runtime value here (export const, enum, class) would make
// Node try to load a .ts file at runtime and crash the API.

// ─── Investigation Request ────────────────────────────────────────────────────

/**
 * Input to AgentOrchestrator.investigate().
 *
 * Only transactionId is accepted from the HTTP client. The backend resolves
 * all other transaction fields from DataService (Dev A) so the agent always
 * works with authoritative data, not client-supplied values.
 */
export interface InvestigationRequest {
  transactionId: string;
}

// ─── Tool Result Envelope ─────────────────────────────────────────────────────

export type ToolStatus = 'success' | 'not_found' | 'unavailable' | 'error';

export interface ToolResultMetadata {
  /** Name of the tool that produced this result */
  tool: string;
  /** Source of the data (e.g. "synthetic-csv", "postgresql") */
  dataSource: string;
  /** Fields that were expected but missing in the underlying data */
  missingFields: string[];
}

export interface ToolResult<T = unknown> {
  status: ToolStatus;
  data: T | null;
  metadata: ToolResultMetadata;
  /** Optional human-readable note — useful when status is not 'success' */
  message?: string;
}

// ─── Investigation Report ─────────────────────────────────────────────────────

export type RiskLevel =
  | 'LOW_RISK'
  | 'SUSPICIOUS'
  | 'HIGH_RISK'
  | 'INCONCLUSIVE';

export type RecommendedAction =
  | 'PROCEED'
  | 'REQUEST_MEMBER_VERIFICATION'
  | 'MANUAL_REVIEW';

export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

/**
 * Structured investigation report produced by the agent.
 * Validated via Zod in PolicyService before any downstream action.
 *
 * IMPORTANT: `confidence` is a qualitative self-assessment by the agent.
 * It is NOT a statistically calibrated fraud probability.
 */
export interface InvestigationReport {
  schemaVersion: '1.0';
  transactionId: string;
  riskLevel: RiskLevel;
  recommendedAction: RecommendedAction;
  /** Names of tools called during this investigation, in order */
  toolsExecuted: string[];
  /** Evidence supporting elevated risk */
  evidenceFor: string[];
  /** Evidence against elevated risk */
  evidenceAgainst: string[];
  /** Information that was sought but unavailable */
  missingInformation: string[];
  /** Conflicting signals found during the investigation */
  contradictions: string[];
  /** Human-readable explanation of the assessment */
  explanation: string;
  requiresHumanReview: boolean;
  confidence: Confidence;
}

// ─── Investigation Result (POST /investigations response) ────────────────────

export interface InvestigationResult {
  /** Server-generated UUID. Required by the member-verification endpoints. */
  investigationId: string;
  report: InvestigationReport;
}

// ─── Member Verification (simulated) ─────────────────────────────────────────

export type VerificationStatus = 'PENDING' | 'CONFIRMED' | 'DENIED';

/** The associate's answer to a pending verification request. */
export type VerificationDecision = Exclude<VerificationStatus, 'PENDING'>;

export interface VerificationRecord {
  investigationId: string;
  transactionId: string;
  status: VerificationStatus;
  /** ISO-8601 */
  requestedAt: string;
  /** ISO-8601 — set once the associate answers */
  resolvedAt?: string;
}
