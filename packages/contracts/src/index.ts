// ─── Investigation Request ────────────────────────────────────────────────────

export interface InvestigationRequest {
  transactionId: string;
  customerId: string;
  amount: number;
  /** ISO-8601 timestamp of the transaction */
  timestamp: string;
  metadata?: Record<string, unknown>;
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
