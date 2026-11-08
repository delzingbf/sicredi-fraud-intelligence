import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataService } from '../data/data.service.js';
import { ToolRegistry } from '../agent/tool.registry.js';
import { AnalyzeSpendingPatternTool } from './analyze-spending-pattern.tool.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  const mockDataService = {
    getCustomerSpendingStats: vi.fn(),
  } satisfies Partial<DataService>;

  const registry = new ToolRegistry();
  const tool = new AnalyzeSpendingPatternTool(
    mockDataService as unknown as DataService,
    registry,
  );
  tool.onModuleInit();

  const execute = (args: Record<string, unknown>) =>
    registry.execute('analyzeSpendingPattern', args);

  return { mockDataService, execute };
}

function makeSpendingStats(overrides: Partial<{
  avgAmount: number | null;
  stddevAmount: number | null;
  p95Amount: number | null;
  transactionCount: number;
  lastTransactionAt: Date | null;
}> = {}) {
  return {
    avgAmount: 100.0,
    stddevAmount: 50.0,
    p95Amount: 300.0,
    transactionCount: 50,
    lastTransactionAt: new Date('2025-03-28T10:00:00.000Z'),
    ...overrides,
  };
}

const VALID_ARGS = {
  transactionId: 'EVT_SYN_000000001',
  customerId: 'CUST_SYN_0000001',
  currentAmount: 200.0,
  timestamp: '2025-03-29T22:48:50.000Z',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AnalyzeSpendingPatternTool', () => {
  let mockDataService: ReturnType<typeof setup>['mockDataService'];
  let execute: ReturnType<typeof setup>['execute'];

  beforeEach(() => {
    ({ mockDataService, execute } = setup());
  });

  it('returns success with computed zScore', async () => {
    // currentAmount=200, avg=100, stddev=50 → zScore=(200-100)/50=2.00
    mockDataService.getCustomerSpendingStats.mockResolvedValueOnce(makeSpendingStats());

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('success');
    expect(result.data?.zScore).toBe(2.0);
    expect(result.data?.historicalTransactionCount).toBe(50);
    expect(result.data?.currentAmount).toBe(200.0);
    expect(result.data?.avgAmount).toBe(100.0);
    expect(result.data?.lastTransactionAt).toBe('2025-03-28T10:00:00.000Z');
  });

  it('returns success with null zScore when stddev is zero', async () => {
    mockDataService.getCustomerSpendingStats.mockResolvedValueOnce(
      makeSpendingStats({ stddevAmount: 0 }),
    );

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('success');
    expect(result.data?.zScore).toBeNull();
  });

  it('returns unavailable when customer has no history', async () => {
    mockDataService.getCustomerSpendingStats.mockResolvedValueOnce(
      makeSpendingStats({
        transactionCount: 0,
        avgAmount: null,
        stddevAmount: null,
        p95Amount: null,
        lastTransactionAt: null,
      }),
    );

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('unavailable');
    expect(result.message).toContain('No historical transactions found');
  });

  it('returns error when required args are missing', async () => {
    const result = await execute({});

    expect(result.status).toBe('error');
  });

  it('returns unavailable when database throws', async () => {
    mockDataService.getCustomerSpendingStats.mockRejectedValueOnce(new Error('DB error'));

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('unavailable');
    expect(result.message).toContain('Database unavailable');
  });

  it('zScore is rounded to 2 decimal places', async () => {
    // currentAmount=150, avg=100, stddev=3 → zScore=(150-100)/3=16.666... → 16.67
    mockDataService.getCustomerSpendingStats.mockResolvedValueOnce(
      makeSpendingStats({ avgAmount: 100, stddevAmount: 3 }),
    );

    const result = await execute({ ...VALID_ARGS, currentAmount: 150 });

    expect(result.status).toBe('success');
    expect(result.data?.zScore).toBe(16.67);
  });

  it('returns success with null zScore when stddev is null', async () => {
    mockDataService.getCustomerSpendingStats.mockResolvedValueOnce(
      makeSpendingStats({ stddevAmount: null }),
    );

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('success');
    expect(result.data?.zScore).toBeNull();
  });
});
