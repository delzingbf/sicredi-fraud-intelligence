import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataService } from '../data/data.service.js';
import { ToolRegistry } from '../agent/tool.registry.js';
import { AnalyzeTransactionContextTool } from './analyze-transaction-context.tool.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  const mockDataService = {
    getCustomerContextStats: vi.fn(),
  } satisfies Partial<DataService>;

  const registry = new ToolRegistry();
  const tool = new AnalyzeTransactionContextTool(
    mockDataService as unknown as DataService,
    registry,
  );
  tool.onModuleInit();

  const execute = (args: Record<string, unknown>) =>
    registry.execute('analyzeTransactionContext', args);

  return { mockDataService, execute };
}

function makeContextStats(overrides: Partial<{
  channelDistribution: Record<string, number>;
  hourDistribution: Record<string, number>;
  totalCount: number;
}> = {}) {
  return {
    channelDistribution: { POS: 30, ATM: 10 },
    hourDistribution: { '10': 15, '11': 12, '12': 8 },
    totalCount: 40,
    ...overrides,
  };
}

// Saturday 03:00 UTC = dayOfWeek=6, hourOfDay=3, isWeekend=true
const SATURDAY_3AM = '2025-03-29T03:00:00.000Z';
// Thursday 11:30 UTC = dayOfWeek=4, hourOfDay=11, isWeekend=false
const THURSDAY_11AM = '2025-03-27T11:30:00.000Z';

const BASE_ARGS = {
  transactionId: 'EVT_SYN_000000001',
  customerId: 'CUST_SYN_0000001',
  channel: 'POS',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AnalyzeTransactionContextTool', () => {
  let mockDataService: ReturnType<typeof setup>['mockDataService'];
  let execute: ReturnType<typeof setup>['execute'];

  beforeEach(() => {
    ({ mockDataService, execute } = setup());
  });

  it('returns success with isUnknownChannel true for new channel', async () => {
    mockDataService.getCustomerContextStats.mockResolvedValueOnce(makeContextStats());

    const result = await execute({
      ...BASE_ARGS,
      channel: 'ecommerce',
      timestamp: THURSDAY_11AM,
    });

    expect(result.status).toBe('success');
    expect(result.data?.isUnknownChannel).toBe(true);
  });

  it('returns success with isUnknownChannel false for known channel', async () => {
    mockDataService.getCustomerContextStats.mockResolvedValueOnce(makeContextStats());

    const result = await execute({
      ...BASE_ARGS,
      channel: 'POS',
      timestamp: THURSDAY_11AM,
    });

    expect(result.status).toBe('success');
    expect(result.data?.isUnknownChannel).toBe(false);
  });

  it('returns success with isUnusualHour true for off-hours transaction', async () => {
    // hour 3 AM — no history around 1,2,3,4,5
    mockDataService.getCustomerContextStats.mockResolvedValueOnce(makeContextStats());

    const result = await execute({
      ...BASE_ARGS,
      timestamp: SATURDAY_3AM,
    });

    expect(result.status).toBe('success');
    expect(result.data?.isUnusualHour).toBe(true);
  });

  it('returns success with isUnusualHour false for normal-hours transaction', async () => {
    // hour 11 — history has '10', '11', '12' which are all within ±2h
    mockDataService.getCustomerContextStats.mockResolvedValueOnce(makeContextStats());

    const result = await execute({
      ...BASE_ARGS,
      timestamp: THURSDAY_11AM,
    });

    expect(result.status).toBe('success');
    expect(result.data?.isUnusualHour).toBe(false);
  });

  it('returns success with empty distributions for new customer', async () => {
    mockDataService.getCustomerContextStats.mockResolvedValueOnce(
      makeContextStats({ channelDistribution: {}, hourDistribution: {}, totalCount: 0 }),
    );

    const result = await execute({
      ...BASE_ARGS,
      timestamp: THURSDAY_11AM,
    });

    expect(result.status).toBe('success');
    expect(result.data?.historicalTransactionCount).toBe(0);
    expect(result.data?.isUnknownChannel).toBe(false);
    expect(result.data?.isUnusualHour).toBe(false);
    expect(result.data?.historicalChannelDistribution).toEqual({});
    expect(result.data?.historicalHourDistribution).toEqual({});
  });

  it('returns error when required args are missing', async () => {
    const result = await execute({});

    expect(result.status).toBe('error');
  });

  it('returns unavailable when database throws', async () => {
    mockDataService.getCustomerContextStats.mockRejectedValueOnce(new Error('DB error'));

    const result = await execute({
      ...BASE_ARGS,
      timestamp: THURSDAY_11AM,
    });

    expect(result.status).toBe('unavailable');
    expect(result.message).toContain('Database unavailable');
  });

  it('correctly computes hourOfDay, dayOfWeek, isWeekend for Saturday 03:00 UTC', async () => {
    mockDataService.getCustomerContextStats.mockResolvedValueOnce(makeContextStats());

    const result = await execute({
      ...BASE_ARGS,
      timestamp: SATURDAY_3AM,
    });

    expect(result.status).toBe('success');
    expect(result.data?.hourOfDay).toBe(3);
    expect(result.data?.dayOfWeek).toBe(6);
    expect(result.data?.isWeekend).toBe(true);
  });
});
