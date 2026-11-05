import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataService } from '../data/data.service.js';
import type { Transaction } from '../data/transaction.entity.js';
import { ToolRegistry } from '../agent/tool.registry.js';
import { GetCustomerProfileTool } from './get-customer-profile.tool.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSnapshot(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'EVT_SYN_000000001',
    customerId: 'CUST_SYN_0000001',
    cardId: null,
    acceptorId: null,
    accountId: null,
    terminalId: null,
    amount: 150.0,
    eventOccurredAt: new Date('2025-03-29T22:48:50Z'),
    tipoTransacao: 'debito',
    modalidadeTransacao: null,
    segmentChannelType: null,
    cardPresenceFlag: null,
    mcc: null,
    acceptorName: null,
    acceptorCity: null,
    acceptorRegion: null,
    acceptorLatitude: null,
    acceptorLongitude: null,
    acceptorRisk: null,
    acceptorRiskyFlag: null,
    acceptorMastercardRisk: null,
    acceptorVisaRisk: null,
    terminalLatitude: null,
    terminalLongitude: null,
    deviceIpLatitude: null,
    deviceIpLongitude: null,
    cardidCount1m: null,
    cpCardPrevTermDist1h: null,
    cpCardTermVel1h: null,
    transactionStatus: 'approved',
    malwareFlag: null,
    customerRiskRating: 'baixo',
    customerName: 'João Silva',
    customerSegment: 'PREMIUM',
    customerCity: 'Porto Alegre',
    customerRegion: 'RS',
    customerRegistrationDate: '2020-01-15',
    customerTotalCreditLimit: 10000.0,
    customerTotalBalance: 5000.0,
    customerPresumedIncome: 8000.0,
    customerOnboardingScore: 0.85,
    customerKycLvl: 'FULL',
    customerNumberOfCards: '2',
    customerEmailChangeFlag: false,
    customerPhoneChangeFlag: false,
    ...overrides,
  } as Transaction;
}

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  const mockDataService = {
    getTransactionById: vi.fn(),
    getLatestCustomerSnapshot: vi.fn(),
  } satisfies Partial<DataService>;

  const registry = new ToolRegistry();
  const tool = new GetCustomerProfileTool(
    mockDataService as unknown as DataService,
    registry,
  );
  tool.onModuleInit();

  const execute = (args: Record<string, unknown>) => registry.execute('getCustomerProfile', args);

  return { mockDataService, execute };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GetCustomerProfileTool', () => {
  let mockDataService: ReturnType<typeof setup>['mockDataService'];
  let execute: ReturnType<typeof setup>['execute'];

  beforeEach(() => {
    ({ mockDataService, execute } = setup());
  });

  it('returns status success with mapped customer fields', async () => {
    const snapshot = makeSnapshot();
    mockDataService.getLatestCustomerSnapshot.mockResolvedValueOnce(snapshot);

    const result = await execute({ customerId: 'CUST_SYN_0000001' });

    expect(result.status).toBe('success');
    expect(result.data).toMatchObject({
      customerId: 'CUST_SYN_0000001',
      name: 'João Silva',
      segment: 'PREMIUM',
      riskRating: 'baixo',
      kycLevel: 'FULL',
    });
    expect(result.metadata.tool).toBe('getCustomerProfile');
    expect(result.metadata.dataSource).toBe('postgresql');
  });

  it('returns status not_found when customer has no transactions', async () => {
    mockDataService.getLatestCustomerSnapshot.mockResolvedValueOnce(null);

    const result = await execute({ customerId: 'CUST_SYN_NOTFOUND' });

    expect(result.status).toBe('not_found');
    expect(result.data).toBeNull();
  });

  it('returns status error when customerId is missing from args', async () => {
    const result = await execute({});

    expect(result.status).toBe('error');
    expect(result.metadata.missingFields).toContain('customerId');
  });

  it('returns status unavailable when the database throws', async () => {
    mockDataService.getLatestCustomerSnapshot.mockRejectedValueOnce(
      new Error('Connection refused'),
    );

    const result = await execute({ customerId: 'CUST_SYN_0000001' });

    expect(result.status).toBe('unavailable');
    expect(result.message).toContain('Database unavailable');
  });

  it('includes name in missingFields when customerName is null', async () => {
    const snapshot = makeSnapshot({ customerName: null });
    mockDataService.getLatestCustomerSnapshot.mockResolvedValueOnce(snapshot);

    const result = await execute({ customerId: 'CUST_SYN_0000001' });

    expect(result.status).toBe('success');
    expect(result.metadata.missingFields).toContain('name');
  });

  it('includes riskRating in missingFields when customerRiskRating is null', async () => {
    const snapshot = makeSnapshot({ customerRiskRating: null });
    mockDataService.getLatestCustomerSnapshot.mockResolvedValueOnce(snapshot);

    const result = await execute({ customerId: 'CUST_SYN_0000001' });

    expect(result.status).toBe('success');
    expect(result.metadata.missingFields).toContain('riskRating');
  });

  it('maps emailChangeFlag and phoneChangeFlag correctly', async () => {
    const snapshot = makeSnapshot({ customerEmailChangeFlag: true, customerPhoneChangeFlag: false });
    mockDataService.getLatestCustomerSnapshot.mockResolvedValueOnce(snapshot);

    const result = await execute({ customerId: 'CUST_SYN_0000001' });

    expect(result.status).toBe('success');
    expect(result.data?.emailChangeFlag).toBe(true);
    expect(result.data?.phoneChangeFlag).toBe(false);
  });
});
