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

// ─── Tool-specific data types ─────────────────────────────────────────────────

/** Data returned by the `getTransactionDetails` tool. */
export interface TransactionDetails {
  transactionId: string;
  customerId: string;
  amount: number | null;
  /** ISO-8601 timestamp */
  timestamp: string;
  /** debito | credito */
  type: string | null;
  modality: string | null;
  channel: string | null;
  cardPresent: boolean | null;
  merchantId: string | null;
  merchantName: string | null;
  merchantCity: string | null;
  merchantRegion: string | null;
  mcc: string | null;
  cardId: string | null;
}

/** Data returned by the `getCustomerProfile` tool. */
export interface CustomerProfile {
  customerId: string;
  name: string | null;
  segment: string | null;
  /** Categorical risk rating: 'baixo' | 'medio' | 'alto' */
  riskRating: string | null;
  city: string | null;
  region: string | null;
  registrationDate: string | null;
  totalCreditLimit: number | null;
  totalBalance: number | null;
  presumedIncome: number | null;
  onboardingScore: number | null;
  kycLevel: string | null;
  numberOfCards: string | null;
  emailChangeFlag: boolean | null;
  phoneChangeFlag: boolean | null;
}

/** Data returned by the `analyzeTransactionVelocity` tool. */
export interface VelocityAnalysis {
  /** Pre-computed from column cardid_count_1m — number of card uses in last 1 min */
  countLast1m: number | null;
  /** Pre-computed from column cp_card_prev_term_dist_1h — distance from previous terminal (km) */
  distPrevTerminal1h: number | null;
  /** Pre-computed from column cp_card_term_vel_1h — velocity between terminals (km/h) */
  velocityTerminal1h: number | null;
  /** Dynamic: count of transactions for this card in the last 1 hour */
  countLast1h: number;
  /** Dynamic: count of transactions for this card in the last 24 hours */
  countLast24h: number;
  /** Dynamic: total amount spent on this card in the last 1 hour */
  totalAmountLast1h: number;
}

/** Data returned by the `analyzeSpendingPattern` tool. */
export interface SpendingPattern {
  /** Average transaction amount from customer history */
  avgAmount: number | null;
  /** Standard deviation of transaction amounts */
  stddevAmount: number | null;
  /** 95th percentile of transaction amounts */
  p95Amount: number | null;
  /** Number of historical transactions used in the calculation */
  historicalTransactionCount: number;
  /** ISO-8601 timestamp of the most recent historical transaction */
  lastTransactionAt: string | null;
  /** Current transaction amount (for comparison) */
  currentAmount: number | null;
  /** How many std deviations the current amount is from the mean (null if stddev=0 or no history) */
  zScore: number | null;
}

/** Data returned by the `analyzeTransactionContext` tool. */
export interface TransactionContext {
  /** Hour of day the transaction occurred (0–23) */
  hourOfDay: number;
  /** Day of week (0=Sunday, 6=Saturday) */
  dayOfWeek: number;
  /** Whether the transaction occurred on a weekend */
  isWeekend: boolean;
  /** Transaction channel from the current transaction */
  channel: string | null;
  /** Transaction type from the current transaction (debito | credito) */
  transactionType: string | null;
  /** Transaction modality from the current transaction */
  modality: string | null;
  /** Whether physical card was present */
  cardPresent: boolean | null;
  /**
   * Customer's historical channel distribution.
   * Keys are channel names, values are transaction counts.
   * Excludes the current transaction.
   */
  historicalChannelDistribution: Record<string, number>;
  /**
   * Customer's historical hour-of-day distribution.
   * Keys are hour strings ("0"–"23"), values are transaction counts.
   */
  historicalHourDistribution: Record<string, number>;
  /** Total historical transactions used for distribution (excludes current) */
  historicalTransactionCount: number;
  /** True if the current channel has never been seen in the customer's history */
  isUnknownChannel: boolean;
  /** True if the current hour bin (±2h) has never been seen in the customer's history */
  isUnusualHour: boolean;
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
