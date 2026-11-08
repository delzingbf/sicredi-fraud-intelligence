import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../agent/tool.registry.js';
import { GetRiskPolicyTool } from './get-risk-policy.tool.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  const registry = new ToolRegistry();
  const tool = new GetRiskPolicyTool(registry);
  tool.onModuleInit();

  const execute = (args: Record<string, unknown>) =>
    registry.execute('getRiskPolicy', args);

  return { execute };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GetRiskPolicyTool', () => {
  it('returns success with policy data', async () => {
    const { execute } = setup();

    const result = await execute({});

    expect(result.status).toBe('success');
    expect(result.data).not.toBeNull();
  });

  it('metadata.dataSource is "static"', async () => {
    const { execute } = setup();

    const result = await execute({});

    expect(result.metadata.dataSource).toBe('static');
    expect(result.metadata.tool).toBe('getRiskPolicy');
    expect(result.metadata.missingFields).toHaveLength(0);
  });

  it('policy contains thresholds for amount, velocity and declines', async () => {
    const { execute } = setup();

    const result = await execute({});
    const data = result.data as Record<string, unknown>;

    expect(typeof data['highRiskAmountThreshold']).toBe('number');
    expect(typeof data['suspiciousVelocityCount1h']).toBe('number');
    expect(typeof data['suspiciousVelocityCount24h']).toBe('number');
    expect(typeof data['highRiskDeclinedLast7d']).toBe('number');
    expect(typeof data['highRiskDeclinedLast30d']).toBe('number');
  });

  it('policy contains riskLevels for all four risk classifications', async () => {
    const { execute } = setup();

    const result = await execute({});
    const data = result.data as Record<string, unknown>;
    const riskLevels = data['riskLevels'] as Record<string, string>;

    expect(riskLevels['LOW_RISK']).toBeTruthy();
    expect(riskLevels['SUSPICIOUS']).toBeTruthy();
    expect(riskLevels['HIGH_RISK']).toBeTruthy();
    expect(riskLevels['INCONCLUSIVE']).toBeTruthy();
  });

  it('policy contains recommendedActions for all three action types', async () => {
    const { execute } = setup();

    const result = await execute({});
    const data = result.data as Record<string, unknown>;
    const actions = data['recommendedActions'] as Record<string, string>;

    expect(actions['PROCEED']).toBeTruthy();
    expect(actions['REQUEST_MEMBER_VERIFICATION']).toBeTruthy();
    expect(actions['MANUAL_REVIEW']).toBeTruthy();
  });
});
