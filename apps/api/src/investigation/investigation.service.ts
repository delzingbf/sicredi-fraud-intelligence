import { Inject, Injectable, Logger } from '@nestjs/common';
import type {
  InvestigationReport,
  InvestigationRequest,
  InvestigationResult,
} from '@fraud-intelligence/contracts';
import {
  AGENT_ORCHESTRATOR,
  AgentError,
  type AgentResult,
  type IAgentOrchestrator,
} from '../agent/agent.orchestrator.interface.js';
import { PolicyService } from '../policy/policy.service.js';
import { InvestigationStore } from './investigation.store.js';

/** Injection token for the investigation timeout (ms), from INVESTIGATION_TIMEOUT_MS. */
export const INVESTIGATION_TIMEOUT_MS = Symbol('INVESTIGATION_TIMEOUT_MS');

/**
 * InvestigationService — use-case entry point for fraud investigation.
 *
 * Flow:
 *   1. Call AgentOrchestrator.investigate() with a timeout + AbortSignal → AgentResult
 *   2. JSON.parse AgentResult.finalText → raw object
 *   3. PolicyService.validate() → typed + semantically-checked InvestigationReport
 *   4. Verify transactionId in report matches the request
 *   5. Overwrite toolsExecuted with the authoritative trace from AgentResult
 *   6. On any failure in steps 1–4 → safe INCONCLUSIVE fallback
 *   7. Store the report and return it with its investigationId
 *
 * This service NEVER throws to the controller. Every error path returns a valid
 * InvestigationReport so the client always receives a well-formed HTTP 200.
 */
@Injectable()
export class InvestigationService {
  private readonly logger = new Logger(InvestigationService.name);

  constructor(
    @Inject(AGENT_ORCHESTRATOR)
    private readonly agent: IAgentOrchestrator,
    private readonly policyService: PolicyService,
    private readonly store: InvestigationStore,
    @Inject(INVESTIGATION_TIMEOUT_MS)
    private readonly timeoutMs: number,
  ) {}

  async investigate(request: InvestigationRequest): Promise<InvestigationResult> {
    const report = await this.buildReport(request);
    const investigationId = this.store.create(report);
    return { investigationId, report };
  }

  private async buildReport(request: InvestigationRequest): Promise<InvestigationReport> {
    // ── Step 1: run the agent loop with a hard timeout ─────────────────────
    let agentResult: AgentResult;
    try {
      agentResult = await this.runAgentWithTimeout(request);
    } catch (err) {
      const safeReason = this.safeAgentErrorReason(err);
      this.logger.warn(
        `Agent failed for transaction ${request.transactionId}: ${safeReason}`,
        err instanceof Error ? err.stack : undefined,
      );
      return this.buildInconclusiveReport(request.transactionId, safeReason);
    }

    // ── Step 2: parse the JSON text produced by the model ─────────────────
    let parsed: unknown;
    try {
      // Strip markdown code fences the model sometimes wraps JSON in.
      const text = agentResult.finalText
        .replace(/^\s*```(?:json)?\s*/i, '')
        .replace(/\s*```\s*$/, '');
      parsed = JSON.parse(text);
    } catch {
      this.logger.warn(
        `Agent response for ${request.transactionId} is not valid JSON. ` +
          `Raw (first 200 chars): ${agentResult.finalText.slice(0, 200)}`,
      );
      return this.buildInconclusiveReport(
        request.transactionId,
        'Agent returned a non-JSON response',
        agentResult.toolsExecuted,
      );
    }

    // ── Step 3: validate schema + semantic invariants ──────────────────────
    const validation = this.policyService.validate(parsed);
    if (!validation.ok) {
      this.logger.warn(
        `Report for ${request.transactionId} failed validation: ${validation.issues.join('; ')}`,
      );
      return this.buildInconclusiveReport(
        request.transactionId,
        'Agent report did not conform to the expected schema',
        agentResult.toolsExecuted,
      );
    }

    // ── Step 4: verify transactionId matches the request ──────────────────
    if (validation.report.transactionId !== request.transactionId) {
      this.logger.warn(
        `Report transactionId mismatch: expected ${request.transactionId}, ` +
          `got ${validation.report.transactionId}`,
      );
      return this.buildInconclusiveReport(
        request.transactionId,
        'Agent report transactionId does not match the request',
        agentResult.toolsExecuted,
      );
    }

    // ── Step 5: overwrite toolsExecuted with the authoritative trace ───────
    return { ...validation.report, toolsExecuted: agentResult.toolsExecuted };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Runs the agent and rejects with AgentError('TIMEOUT') after timeoutMs.
   * The AbortSignal handed to the agent is aborted at the same moment so the
   * orchestrator can stop calling IBM instead of running on in the background.
   */
  private async runAgentWithTimeout(request: InvestigationRequest): Promise<AgentResult> {
    const controller = new AbortController();
    const timedOut = new Promise<never>((_, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => reject(new AgentError('TIMEOUT', `Investigation exceeded ${this.timeoutMs}ms`)),
        { once: true },
      );
    });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await Promise.race([
        this.agent.investigate(request, controller.signal),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Maps any thrown value to a safe, fixed string suitable for client-facing
   * fields (missingInformation / explanation). Internal details are logged
   * server-side but never exposed to the client.
   */
  private safeAgentErrorReason(err: unknown): string {
    if (err instanceof AgentError) {
      switch (err.code) {
        case 'IBM_ERROR':      return 'IBM watsonx.ai API error';
        case 'ROUND_LIMIT':    return 'Investigation round limit reached without conclusion';
        case 'EMPTY_RESPONSE': return 'Agent produced an empty response';
        case 'TIMEOUT':        return 'Investigation timed out';
      }
    }
    return 'Internal agent error';
  }

  private buildInconclusiveReport(
    transactionId: string,
    reason: string,
    toolsExecuted: string[] = [],
  ): InvestigationReport {
    return {
      schemaVersion: '1.0',
      transactionId,
      riskLevel: 'INCONCLUSIVE',
      recommendedAction: 'MANUAL_REVIEW',
      toolsExecuted,
      evidenceFor: [],
      evidenceAgainst: [],
      missingInformation: [reason],
      contradictions: [],
      explanation: `Investigation could not be completed: ${reason}. Manual review is required.`,
      requiresHumanReview: true,
      confidence: 'LOW',
    };
  }
}
