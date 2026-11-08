import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataService } from '../data/data.service.js';
import { ToolRegistry } from '../agent/tool.registry.js';
import { CheckMerchantHistoryTool } from './check-merchant-history.tool.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  const mockDataService = {
    getMerchantHistory: vi.fn(),
  } satisfies Partial<DataService>;

  const registry = new ToolRegistry();
  const tool = new CheckMerchantHistoryTool(
    mockDataService as unknown as DataService,
    registry,
  );
  tool.onModuleInit();

  const execute = (args: Record<string, unknown>) =>
    registry.execute('checkMerchantHistory', args);

  return { mockDataService, execute };
}

function makeMerchantHistory(overrides: Partial<{
  totalTransactions: number;
  avgAmount: number | null;
  maxAmount: number | null;
  minAmount: number | null;
  acceptorRisk: number | null;
  acceptorRiskyFlag: number | null;
  acceptorMastercardRisk: number | null;
  acceptorVisaRisk: number | null;
}> = {}) {
  return {
    totalTransactions: 150,
    avgAmount: 250.0,
    maxAmount: 1200.0,
    minAmount: 10.0,
    acceptorRisk: 0.2,
    acceptorRiskyFlag: 0,
    acceptorMastercardRisk: 0.15,
    acceptorVisaRisk: 0.18,
    ...overrides,
  };
}

const VALID_ARGS = {
  merchantId: 'MERCH_001',
  transactionId: 'EVT_SYN_000000001',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CheckMerchantHistoryTool', () => {
  let mockDataService: ReturnType<typeof setup>['mockDataService'];
  let execute: ReturnType<typeof setup>['execute'];

  beforeEach(() => {
    ({ mockDataService, execute } = setup());
  });

  it('returns error when merchantId is missing', async () => {
    const result = await execute({ transactionId: 'EVT_SYN_000000001' });

    expect(result.status).toBe('error');
    expect(result.metadata.missingFields).toContain('merchantId');
  });

  it('returns error when transactionId is missing', async () => {
    const result = await execute({ merchantId: 'MERCH_001' });

    expect(result.status).toBe('error');
    expect(result.metadata.missingFields).toContain('transactionId');
  });

  it('returns success with all fields when DB returns complete data', async () => {
    mockDataService.getMerchantHistory.mockResolvedValueOnce(makeMerchantHistory());

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('success');
    expect(result.data?.merchantId).toBe('MERCH_001');
    expect(result.data?.totalTransactions).toBe(150);
    expect(result.data?.avgAmount).toBe(250.0);
    expect(result.data?.maxAmount).toBe(1200.0);
    expect(result.data?.minAmount).toBe(10.0);
    expect(result.data?.acceptorRisk).toBe(0.2);
    expect(result.data?.acceptorRiskyFlag).toBe(0);
    expect(result.data?.acceptorMastercardRisk).toBe(0.15);
    expect(result.data?.acceptorVisaRisk).toBe(0.18);
  });

  it('returns success with null amounts when merchant has no amount history', async () => {
    mockDataService.getMerchantHistory.mockResolvedValueOnce(
      makeMerchantHistory({
        totalTransactions: 0,
        avgAmount: null,
        maxAmount: null,
        minAmount: null,
      }),
    );

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('success');
    expect(result.data?.avgAmount).toBeNull();
    expect(result.data?.maxAmount).toBeNull();
    expect(result.data?.minAmount).toBeNull();
  });

  it('returns unavailable when database throws', async () => {
    mockDataService.getMerchantHistory.mockRejectedValueOnce(new Error('DB error'));

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('unavailable');
    expect(result.message).toBe('Database unavailable');
  });

  it('merchantId in response data equals the input arg', async () => {
    mockDataService.getMerchantHistory.mockResolvedValueOnce(makeMerchantHistory());

    const result = await execute(VALID_ARGS);

    expect(result.data?.merchantId).toBe(VALID_ARGS.merchantId);
  });
});
