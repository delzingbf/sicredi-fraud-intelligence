import { describe, it, expect, vi } from 'vitest';
import type { InvestigationReport, InvestigationRequest } from '@fraud-intelligence/contracts';
import { InvestigationService } from './investigation.service.js';
import { InvestigationStore } from './investigation.store.js';
import { PolicyService } from '../policy/policy.service.js';
import {
  AgentError,
  type AgentResult,
  type IAgentOrchestrator,
} from '../agent/agent.orchestrator.interface.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const baseRequest: InvestigationRequest = {
  transactionId: 'TX-001',
};

function validReport(
  overrides: Partial<InvestigationReport> = {},
): InvestigationReport {
  return {
    schemaVersion: '1.0',
    transactionId: 'TX-001',
    riskLevel: 'HIGH_RISK',
    recommendedAction: 'MANUAL_REVIEW',
    toolsExecuted: ['getTransactionDetails'],
    evidenceFor: ['Amount 4x above average'],
    evidenceAgainst: [],
    missingInformation: [],
    contradictions: [],
    explanation: 'Transaction is suspicious.',
    requiresHumanReview: true,
    confidence: 'HIGH',
    ...overrides,
  };
}

function makeService(
  investigate: IAgentOrchestrator['investigate'],
  timeoutMs = 30_000,
): { service: InvestigationService; store: InvestigationStore } {
  const agent: IAgentOrchestrator = { investigate: vi.fn(investigate) };
  const store = new InvestigationStore();
  const service = new InvestigationService(agent, new PolicyService(), store, timeoutMs);
  return { service, store };
}

function agentOk(report: unknown, toolsExecuted = ['getTransactionDetails']): () => Promise<AgentResult> {
  return () => Promise.resolve({ finalText: JSON.stringify(report), toolsExecuted });
}

async function reportFor(investigate: IAgentOrchestrator['investigate']): Promise<InvestigationReport> {
  const { service } = makeService(investigate);
  return (await service.investigate(baseRequest)).report;
}

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('InvestigationService.investigate() — happy path', () => {
  it('returns a validated InvestigationReport when agent produces valid JSON', async () => {
    const report = await reportFor(agentOk(validReport()));
    expect(report.riskLevel).toBe('HIGH_RISK');
    expect(report.transactionId).toBe('TX-001');
    expect(report.schemaVersion).toBe('1.0');
  });

  it('stores the report under a new UUID investigationId', async () => {
    const { service, store } = makeService(agentOk(validReport()));
    const result = await service.investigate(baseRequest);
    expect(result.investigationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(store.find(result.investigationId)?.report).toEqual(result.report);
  });

  it('stores fallback reports too', async () => {
    const { service, store } = makeService(() => Promise.reject(new Error('boom')));
    const result = await service.investigate(baseRequest);
    expect(store.find(result.investigationId)?.report.riskLevel).toBe('INCONCLUSIVE');
  });

  it('overwrites toolsExecuted with the authoritative trace from AgentResult', async () => {
    const report = await reportFor(
      agentOk(validReport({ toolsExecuted: ['hallucinated'] }), ['getTransactionDetails', 'analyzeVelocity']),
    );
    expect(report.toolsExecuted).toEqual(['getTransactionDetails', 'analyzeVelocity']);
  });

  it('strips markdown fences before parsing', async () => {
    const report = await reportFor(() =>
      Promise.resolve({ finalText: '```json\n' + JSON.stringify(validReport()) + '\n```', toolsExecuted: [] }),
    );
    expect(report.riskLevel).toBe('HIGH_RISK');
  });
});

// ─── Agent error paths ────────────────────────────────────────────────────────

describe('InvestigationService.investigate() — agent errors produce INCONCLUSIVE', () => {
  it.each([
    ['IBM_ERROR', 'IBM watsonx.ai API error'],
    ['ROUND_LIMIT', 'round limit'],
    ['EMPTY_RESPONSE', 'empty response'],
    ['TIMEOUT', 'timed out'],
  ] as const)('handles AgentError %s', async (code, expectedSubstring) => {
    const report = await reportFor(() => Promise.reject(new AgentError(code, 'detail')));
    expect(report.riskLevel).toBe('INCONCLUSIVE');
    expect(report.missingInformation[0].toLowerCase()).toContain(expectedSubstring.toLowerCase());
  });

  it('does NOT leak err.message for unknown errors', async () => {
    const report = await reportFor(() => Promise.reject(new Error('ECONNREFUSED 10.0.0.1:5432')));
    expect(report.riskLevel).toBe('INCONCLUSIVE');
    expect(JSON.stringify(report)).not.toContain('ECONNREFUSED');
    expect(JSON.stringify(report)).not.toContain('10.0.0.1');
    expect(report.missingInformation[0]).toBe('Internal agent error');
  });

  it('keeps the authoritative tool trace when the final output is invalid', async () => {
    const report = await reportFor(() =>
      Promise.resolve({ finalText: 'not json', toolsExecuted: ['getTransactionDetails'] }),
    );
    expect(report.riskLevel).toBe('INCONCLUSIVE');
    expect(report.toolsExecuted).toEqual(['getTransactionDetails']);
  });
});

// ─── Parse error paths ────────────────────────────────────────────────────────

describe('InvestigationService.investigate() — unparseable agent output', () => {
  it.each([
    ['plain prose', 'The transaction looks suspicious.'],
    ['empty string', ''],
  ])('returns INCONCLUSIVE for %s', async (_label, finalText) => {
    const report = await reportFor(() => Promise.resolve({ finalText, toolsExecuted: [] }));
    expect(report.riskLevel).toBe('INCONCLUSIVE');
  });
});

// ─── Schema validation / semantic invariants ──────────────────────────────────

describe('InvestigationService.investigate() — schema/semantic failures', () => {
  it('returns INCONCLUSIVE for unrecognized riskLevel', async () => {
    const report = await reportFor(agentOk({ ...validReport(), riskLevel: 'OOPS' }));
    expect(report.riskLevel).toBe('INCONCLUSIVE');
  });

  it('returns INCONCLUSIVE for LOW_RISK + REQUEST_MEMBER_VERIFICATION (semantic invariant)', async () => {
    const report = await reportFor(
      agentOk(validReport({ riskLevel: 'LOW_RISK', recommendedAction: 'REQUEST_MEMBER_VERIFICATION' })),
    );
    expect(report.riskLevel).toBe('INCONCLUSIVE');
  });

  it('returns INCONCLUSIVE when transactionId in report does not match request', async () => {
    const report = await reportFor(agentOk(validReport({ transactionId: 'TX-OTHER' })));
    expect(report.riskLevel).toBe('INCONCLUSIVE');
    expect(report.transactionId).toBe('TX-001');
  });
});

// ─── Timeout ─────────────────────────────────────────────────────────────────

describe('InvestigationService.investigate() — timeout', () => {
  it('returns INCONCLUSIVE "timed out" and aborts the agent signal', async () => {
    let received: AbortSignal | undefined;
    const { service } = makeService((_request, signal) => {
      received = signal;
      return new Promise<AgentResult>(() => { /* never resolves */ });
    }, 1);

    const { report } = await service.investigate(baseRequest);

    expect(report.riskLevel).toBe('INCONCLUSIVE');
    expect(report.missingInformation[0]).toBe('Investigation timed out');
    expect(received?.aborted).toBe(true);
  });

  it('does not abort the signal when the agent finishes in time', async () => {
    let received: AbortSignal | undefined;
    const { service } = makeService((_request, signal) => {
      received = signal;
      return agentOk(validReport())();
    }, 1_000);

    await service.investigate(baseRequest);

    expect(received?.aborted).toBe(false);
  });
});

// ─── Invariants ───────────────────────────────────────────────────────────────

describe('InvestigationService.investigate() — invariants', () => {
  it('never throws, even on a synchronous crash inside the agent', async () => {
    const { service } = makeService(() => { throw new Error('Sync crash'); });
    await expect(service.investigate(baseRequest)).resolves.toMatchObject({
      report: { riskLevel: 'INCONCLUSIVE', requiresHumanReview: true },
    });
  });

  it('fallback report always has schemaVersion 1.0 and confidence LOW', async () => {
    const report = await reportFor(() => Promise.resolve({ finalText: 'garbage', toolsExecuted: [] }));
    expect(report.schemaVersion).toBe('1.0');
    expect(report.confidence).toBe('LOW');
  });
});
