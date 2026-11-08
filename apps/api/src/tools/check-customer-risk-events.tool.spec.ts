import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataService } from '../data/data.service.js';
import { ToolRegistry } from '../agent/tool.registry.js';
import { CheckCustomerRiskEventsTool } from './check-customer-risk-events.tool.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  const mockDataService = {
    getCustomerRiskEvents: vi.fn(),
  } satisfies Partial<DataService>;

  const registry = new ToolRegistry();
  const tool = new CheckCustomerRiskEventsTool(
    mockDataService as unknown as DataService,
    registry,
  );
  tool.onModuleInit();

  const execute = (args: Record<string, unknown>) =>
    registry.execute('checkCustomerRiskEvents', args);

  return { mockDataService, execute };
}

const VALID_ARGS = {
  customerId: 'CUST_SYN_0000001',
  transactionId: 'EVT_SYN_000000001',
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CheckCustomerRiskEventsTool', () => {
  let mockDataService: ReturnType<typeof setup>['mockDataService'];
  let execute: ReturnType<typeof setup>['execute'];

  beforeEach(() => {
    ({ mockDataService, execute } = setup());
  });

  it('returns error when customerId is missing', async () => {
    const result = await execute({ transactionId: 'EVT_SYN_000000001' });

    expect(result.status).toBe('error');
    expect(result.metadata.missingFields).toContain('customerId');
  });

  it('returns error when transactionId is missing', async () => {
    const result = await execute({ customerId: 'CUST_SYN_0000001' });

    expect(result.status).toBe('error');
    expect(result.metadata.missingFields).toContain('transactionId');
  });

  it('returns success for high-risk customer with malware and declines', async () => {
    mockDataService.getCustomerRiskEvents.mockResolvedValueOnce({
      riskRating: 'alto',
      malwareFlag: true,
      declinedLast30d: 8,
      declinedLast7d: 4,
    });

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('success');
    expect(result.data?.riskRating).toBe('alto');
    expect(result.data?.malwareFlag).toBe(true);
    expect(result.data?.declinedLast30d).toBe(8);
    expect(result.data?.declinedLast7d).toBe(4);
  });

  it('returns success with zero declines for clean customer', async () => {
    mockDataService.getCustomerRiskEvents.mockResolvedValueOnce({
      riskRating: 'baixo',
      malwareFlag: false,
      declinedLast30d: 0,
      declinedLast7d: 0,
    });

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('success');
    expect(result.data?.declinedLast30d).toBe(0);
    expect(result.data?.declinedLast7d).toBe(0);
  });

  it('returns success when riskRating and malwareFlag are null', async () => {
    mockDataService.getCustomerRiskEvents.mockResolvedValueOnce({
      riskRating: null,
      malwareFlag: null,
      declinedLast30d: 1,
      declinedLast7d: 0,
    });

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('success');
    expect(result.data?.riskRating).toBeNull();
    expect(result.data?.malwareFlag).toBeNull();
  });

  it('returns unavailable when database throws', async () => {
    mockDataService.getCustomerRiskEvents.mockRejectedValueOnce(new Error('DB error'));

    const result = await execute(VALID_ARGS);

    expect(result.status).toBe('unavailable');
    expect(result.message).toBe('Database unavailable');
  });
});
