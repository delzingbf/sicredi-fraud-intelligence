import { describe, it, expect } from 'vitest';
import type { InvestigationReport } from '@fraud-intelligence/contracts';
import { PolicyService } from './policy.service.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validReport(
  overrides: Partial<InvestigationReport> = {},
): InvestigationReport {
  return {
    schemaVersion: '1.0',
    transactionId: 'TX-001',
    riskLevel: 'HIGH_RISK',
    recommendedAction: 'REQUEST_MEMBER_VERIFICATION',
    toolsExecuted: ['getTransactionDetails', 'getCustomerProfile'],
    evidenceFor: ['Amount 4x above average'],
    evidenceAgainst: [],
    missingInformation: [],
    contradictions: [],
    explanation: 'Transaction is highly suspicious.',
    requiresHumanReview: true,
    confidence: 'HIGH',
    ...overrides,
  };
}

// ─── validate() ───────────────────────────────────────────────────────────────

describe('PolicyService.validate()', () => {
  const service = new PolicyService();

  it('returns { ok: true, report } for a valid report', () => {
    const report = validReport();
    const result = service.validate(report);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.report).toEqual(report);
  });

  it('returns { ok: false } when riskLevel is invalid', () => {
    const result = service.validate(validReport({ riskLevel: 'VERY_BAD' as never }));
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } when schemaVersion is missing', () => {
    const { schemaVersion: _sv, ...raw } = validReport();
    const result = service.validate(raw);
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } when schemaVersion is wrong literal', () => {
    const result = service.validate(validReport({ schemaVersion: 2 as never }));
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } when explanation is empty', () => {
    const result = service.validate(validReport({ explanation: '' }));
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } when transactionId is empty', () => {
    const result = service.validate(validReport({ transactionId: '' }));
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } when input is a plain string', () => {
    const result = service.validate('{"riskLevel":"HIGH_RISK"}');
    expect(result.ok).toBe(false);
  });

  it('returns { ok: false } when input is null', () => {
    const result = service.validate(null);
    expect(result.ok).toBe(false);
  });

  it('issues array contains the failing field name', () => {
    const result = service.validate(validReport({ riskLevel: 'OOPS' as never }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.join(' ')).toContain('riskLevel');
  });

  it('accepts all valid riskLevel values', () => {
    const levels: InvestigationReport['riskLevel'][] = ['LOW_RISK', 'SUSPICIOUS', 'HIGH_RISK', 'INCONCLUSIVE'];
    for (const riskLevel of levels) {
      const result = service.validate(validReport({ riskLevel, recommendedAction: 'MANUAL_REVIEW' }));
      expect(result.ok).toBe(true);
    }
  });

  it('accepts all valid confidence values', () => {
    for (const confidence of ['LOW', 'MEDIUM', 'HIGH'] as const) {
      expect(service.validate(validReport({ confidence })).ok).toBe(true);
    }
  });

  // ── Semantic invariants ───────────────────────────────────────────────────

  it('rejects LOW_RISK + REQUEST_MEMBER_VERIFICATION (semantic invariant)', () => {
    const result = service.validate(
      validReport({ riskLevel: 'LOW_RISK', recommendedAction: 'REQUEST_MEMBER_VERIFICATION' }),
    );
    expect(result.ok).toBe(false);
  });

  it.each([
    ['INCONCLUSIVE', 'PROCEED'],
    ['SUSPICIOUS', 'PROCEED'],
    ['HIGH_RISK', 'PROCEED'],
  ] as const)('rejects %s + %s (only LOW_RISK may PROCEED)', (riskLevel, recommendedAction) => {
    const result = service.validate(validReport({ riskLevel, recommendedAction }));
    expect(result.ok).toBe(false);
  });

  it('accepts LOW_RISK + PROCEED', () => {
    const result = service.validate(
      validReport({ riskLevel: 'LOW_RISK', recommendedAction: 'PROCEED', requiresHumanReview: false }),
    );
    expect(result.ok).toBe(true);
  });

  it('rejects INCONCLUSIVE + requiresHumanReview: false (semantic invariant)', () => {
    const result = service.validate(
      validReport({ riskLevel: 'INCONCLUSIVE', recommendedAction: 'MANUAL_REVIEW', requiresHumanReview: false }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects HIGH_RISK + confidence HIGH + empty evidenceFor (semantic invariant)', () => {
    const result = service.validate(
      validReport({ riskLevel: 'HIGH_RISK', confidence: 'HIGH', evidenceFor: [] }),
    );
    expect(result.ok).toBe(false);
  });
});

// ─── canRequestMemberVerification() ──────────────────────────────────────────

describe('PolicyService.canRequestMemberVerification()', () => {
  const service = new PolicyService();

  it.each([
    ['HIGH_RISK', 'REQUEST_MEMBER_VERIFICATION', true],
    ['SUSPICIOUS', 'REQUEST_MEMBER_VERIFICATION', true],
    ['LOW_RISK', 'REQUEST_MEMBER_VERIFICATION', false],
    ['INCONCLUSIVE', 'REQUEST_MEMBER_VERIFICATION', false],
    ['HIGH_RISK', 'PROCEED', false],
    ['HIGH_RISK', 'MANUAL_REVIEW', false],
    ['SUSPICIOUS', 'PROCEED', false],
  ] as const)('%s + %s → %s', (riskLevel, recommendedAction, expected) => {
    expect(
      service.canRequestMemberVerification(validReport({ riskLevel, recommendedAction })),
    ).toBe(expected);
  });
});
