import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataService } from '../data/data.service.js';
import { ToolRegistry } from '../agent/tool.registry.js';
import { AnalyzeTransactionVelocityTool } from './analyze-transaction-velocity.tool.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  const mockDataService = {
    getCardVelocity: vi.fn(),
  } satisfies Partial<DataService>;

  const registry = new ToolRegistry();
  const tool = new AnalyzeTransactionVelocityTool(
    mockDataService as unknown as DataService,
    registry,
  );
  tool.onModuleInit();

  const execute = (args: Record<string, unknown>) =>
    registry.execute('analyzeTransactionVelocity', args);

  return { mockDataService, execute };
}

function makeVelocityResult(overrides: Partial<{
  precomputed: { cardidCount1m: string | null; cpCardPrevTermDist1h: string | null; cpCardTermVel1h: string | null } | null;
  countLast1h: number;
  countLast24h: number;
  totalAmountLast1h: number;
}> = {}) {
  return {
    precomputed: {
      cardidCount1m: '3',
      cpCardPrevTermDist1h: '12.5',
      cpCardTermVel1h: '87.6',
    },
    countLast1h: 2,
    countLast24h: 5,
    totalAmountLast1h: 300.0,
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('AnalyzeTransactionVelocityTool', () => {
  let mockDataService: ReturnType<typeof setup>['mockDataService'];
  let execute: ReturnType<typeof setup>['execute'];

  beforeEach(() => {
    ({ mockDataService, execute } = setup());
  });

  it('returns success with all velocity fields', async () => {
    mockDataService.getCardVelocity.mockResolvedValueOnce(makeVelocityResult());

    const result = await execute({
      transactionId: 'EVT_SYN_000000001',
      cardId: 'CARD_001',
      timestamp: '2025-03-29T22:48:50.000Z',
    });

    expect(result.status).toBe('success');
    expect(result.data).toMatchObject({
      countLast1m: 3,
      distPrevTerminal1h: 12.5,
      velocityTerminal1h: 87.6,
      countLast1h: 2,
      countLast24h: 5,
      totalAmountLast1h: 300.0,
    });
    expect(result.metadata.tool).toBe('analyzeTransactionVelocity');
    expect(result.metadata.dataSource).toBe('postgresql');
    expect(result.metadata.missingFields).toHaveLength(0);
  });

  it('returns success with null precomputed fields in missingFields', async () => {
    mockDataService.getCardVelocity.mockResolvedValueOnce(
      makeVelocityResult({
        precomputed: { cardidCount1m: null, cpCardPrevTermDist1h: null, cpCardTermVel1h: null },
      }),
    );

    const result = await execute({
      transactionId: 'EVT_SYN_000000001',
      cardId: 'CARD_001',
      timestamp: '2025-03-29T22:48:50.000Z',
    });

    expect(result.status).toBe('success');
    expect(result.data?.countLast1m).toBeNull();
    expect(result.data?.distPrevTerminal1h).toBeNull();
    expect(result.data?.velocityTerminal1h).toBeNull();
    expect(result.metadata.missingFields).toContain('cardidCount1m');
    expect(result.metadata.missingFields).toContain('cpCardPrevTermDist1h');
    expect(result.metadata.missingFields).toContain('cpCardTermVel1h');
    // Dynamic fields still returned
    expect(result.data?.countLast1h).toBe(2);
  });

  it('returns error when transactionId is missing', async () => {
    const result = await execute({});

    expect(result.status).toBe('error');
    expect(result.metadata.missingFields).toContain('transactionId');
  });

  it('returns error when cardId is missing', async () => {
    const result = await execute({ transactionId: 'EVT_SYN_000000001' });

    expect(result.status).toBe('error');
    expect(result.metadata.missingFields).toContain('cardId');
  });

  it('returns error when timestamp is not valid ISO-8601', async () => {
    const result = await execute({
      transactionId: 'EVT_SYN_000000001',
      cardId: 'CARD_001',
      timestamp: 'not-a-date',
    });

    expect(result.status).toBe('error');
    expect(result.metadata.missingFields).toContain('timestamp');
  });

  it('returns unavailable when database throws', async () => {
    mockDataService.getCardVelocity.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await execute({
      transactionId: 'EVT_SYN_000000001',
      cardId: 'CARD_001',
      timestamp: '2025-03-29T22:48:50.000Z',
    });

    expect(result.status).toBe('unavailable');
    expect(result.message).toContain('Database unavailable');
  });

  it('parses varchar precomputed fields to numbers', async () => {
    mockDataService.getCardVelocity.mockResolvedValueOnce(
      makeVelocityResult({
        precomputed: { cardidCount1m: '5', cpCardPrevTermDist1h: '12.3', cpCardTermVel1h: '87.6' },
      }),
    );

    const result = await execute({
      transactionId: 'EVT_SYN_000000001',
      cardId: 'CARD_001',
      timestamp: '2025-03-29T22:48:50.000Z',
    });

    expect(result.status).toBe('success');
    expect(result.data?.countLast1m).toBe(5);
    expect(result.data?.distPrevTerminal1h).toBe(12.3);
    expect(result.data?.velocityTerminal1h).toBe(87.6);
  });
});
