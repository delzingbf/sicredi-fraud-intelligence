import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DataService } from './data.service.js';
import type { Transaction } from './transaction.entity.js';
import type { Repository } from 'typeorm';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 'EVT_SYN_000000001',
    customerId: 'CUST_SYN_0000001',
    cardId: 'CARD_001',
    acceptorId: 'ACC_001',
    accountId: null,
    terminalId: null,
    amount: 150.0,
    eventOccurredAt: new Date('2025-03-29T22:48:50Z'),
    tipoTransacao: 'debito',
    modalidadeTransacao: 'presencial',
    segmentChannelType: 'POS',
    cardPresenceFlag: true,
    mcc: '5411',
    acceptorName: 'Supermercado ABC',
    acceptorCity: 'Porto Alegre',
    acceptorRegion: 'RS',
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

function makeMockRepo(): {
  findOne: ReturnType<typeof vi.fn>;
} & Partial<Repository<Transaction>> {
  return {
    findOne: vi.fn(),
  };
}

// ── DataService.getTransactionById ────────────────────────────────────────────

describe('DataService.getTransactionById', () => {
  let service: DataService;
  let repo: ReturnType<typeof makeMockRepo>;

  beforeEach(() => {
    repo = makeMockRepo();
    service = new DataService(repo as unknown as Repository<Transaction>);
  });

  it('returns the transaction when found', async () => {
    const tx = makeTransaction();
    repo.findOne.mockResolvedValueOnce(tx);

    const result = await service.getTransactionById('EVT_SYN_000000001');

    expect(result).toBe(tx);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 'EVT_SYN_000000001' } });
  });

  it('returns null when the transaction is not found', async () => {
    repo.findOne.mockResolvedValueOnce(null);

    const result = await service.getTransactionById('EVT_SYN_NOTFOUND');

    expect(result).toBeNull();
  });
});

// ── DataService.getLatestCustomerSnapshot ─────────────────────────────────────

describe('DataService.getLatestCustomerSnapshot', () => {
  let service: DataService;
  let repo: ReturnType<typeof makeMockRepo>;

  beforeEach(() => {
    repo = makeMockRepo();
    service = new DataService(repo as unknown as Repository<Transaction>);
  });

  it('returns the most recent transaction for a customer', async () => {
    const tx = makeTransaction({ customerId: 'CUST_SYN_0000001' });
    repo.findOne.mockResolvedValueOnce(tx);

    const result = await service.getLatestCustomerSnapshot('CUST_SYN_0000001');

    expect(result).toBe(tx);
    expect(repo.findOne).toHaveBeenCalledWith({
      where: { customerId: 'CUST_SYN_0000001' },
      order: { eventOccurredAt: 'DESC' },
    });
  });

  it('returns null when the customer has no transactions', async () => {
    repo.findOne.mockResolvedValueOnce(null);

    const result = await service.getLatestCustomerSnapshot('CUST_SYN_NOTFOUND');

    expect(result).toBeNull();
  });
});
