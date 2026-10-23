import type { InvestigationRequest } from '@fraud-intelligence/contracts';

/**
 * Error codes produced by AgentOrchestrator.investigate().
 *
 * Dev B (InvestigationService) maps each code to an appropriate fallback.
 * Dev C (AgentOrchestrator) throws AgentError with one of these codes when the
 * loop cannot produce a normal response.
 *
 *   IBM_ERROR      — IBM Chat API returned non-2xx or network failed.
 *   ROUND_LIMIT    — MAX_INVESTIGATION_ROUNDS reached; model never stopped calling tools.
 *   EMPTY_RESPONSE — Loop completed but model returned an empty final content string.
 *   TIMEOUT        — The investigation exceeded INVESTIGATION_TIMEOUT_MS. Raised by
 *                    InvestigationService; the orchestrator only needs to stop when
 *                    the AbortSignal fires.
 */
export type AgentErrorCode =
  | 'IBM_ERROR'
  | 'ROUND_LIMIT'
  | 'EMPTY_RESPONSE'
  | 'TIMEOUT';

export class AgentError extends Error {
  constructor(
    public readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AgentError';
  }
}

/**
 * Result returned by a successful AgentOrchestrator.investigate() call.
 *
 *   finalText     — The model's final text output. InvestigationService will
 *                   JSON.parse this and validate against InvestigationReport schema.
 *   toolsExecuted — Ordered list of tool names actually dispatched by the loop.
 *                   InvestigationService overwrites the agent's self-reported
 *                   toolsExecuted with this authoritative trace so the frontend
 *                   cannot be deceived by a hallucinated tool list.
 */
export interface AgentResult {
  finalText: string;
  toolsExecuted: string[];
}

/**
 * Contract between Dev B (InvestigationService) and Dev C (AgentOrchestrator).
 *
 * AgentOrchestrator MUST implement this interface.
 * InvestigationService depends on the AGENT_ORCHESTRATOR token, not the concrete
 * class, allowing Dev B to use a mock independently of Dev C's implementation.
 *
 * signal — aborted when the investigation times out. The orchestrator must pass
 *          it to every fetch() towards IBM and check signal.aborted between
 *          rounds, so no paid calls keep running after the client got its answer.
 *
 * Happy path: resolves with AgentResult.
 * Error path:  rejects with AgentError (one of AgentErrorCode values).
 */
export interface IAgentOrchestrator {
  investigate(
    request: InvestigationRequest,
    signal: AbortSignal,
  ): Promise<AgentResult>;
}

/**
 * NestJS injection token for IAgentOrchestrator.
 *
 * AgentModule registers: { provide: AGENT_ORCHESTRATOR, useClass: AgentOrchestrator }
 * InvestigationService injects: @Inject(AGENT_ORCHESTRATOR) agent: IAgentOrchestrator
 */
export const AGENT_ORCHESTRATOR = Symbol('AGENT_ORCHESTRATOR');
