import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import { Transaction } from './transaction.entity.js';

/**
 * DataService — sole gateway between the application and the `transactions` table.
 *
 * Security invariant: `feedback_label` is not mapped in the Transaction entity,
 * so it can never be selected or returned by any method here.
 *
 * Each method is independent and designed to grow without refactoring existing
 * methods (Sub-Tasks 6 and 7 will add `getCardVelocity`, `getSpendingStats`, etc.).
 */
@Injectable()
export class DataService {
  constructor(
    @InjectRepository(Transaction)
    private readonly repo: Repository<Transaction>,
  ) {}

  /**
   * Fetches a transaction by its `event_external_id`.
   * Returns `null` if not found — never throws on missing data.
   */
  async getTransactionById(id: string): Promise<Transaction | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * Returns the most recent snapshot of a customer by reading the latest
   * transaction for the given `customer_id`.
   *
   * Customer fields vary per transaction (snapshot semantics, no separate table).
   * Returns `null` if the customer has no transactions.
   */
  async getLatestCustomerSnapshot(customerId: string): Promise<Transaction | null> {
    return this.repo.findOne({
      where: { customerId },
      order: { eventOccurredAt: 'DESC' },
    });
  }

  /**
   * Returns velocity data for a card:
   *  - Pre-computed columns from the target transaction row
   *  - Dynamic counts/amounts for 1h and 24h windows
   *
   * The timestamp parameter is the target transaction's eventOccurredAt.
   * Only transactions strictly before that timestamp are counted (pre-authorization).
   */
  async getCardVelocity(
    cardId: string,
    cardTransactionId: string,
    timestamp: Date,
  ): Promise<{
    precomputed: Pick<Transaction, 'cardidCount1m' | 'cpCardPrevTermDist1h' | 'cpCardTermVel1h'> | null;
    countLast1h: number;
    countLast24h: number;
    totalAmountLast1h: number;
  }> {
    // 1. Fetch pre-computed fields from the target transaction
    const row = await this.repo.findOne({
      where: { id: cardTransactionId },
      select: ['cardidCount1m', 'cpCardPrevTermDist1h', 'cpCardTermVel1h'],
    });

    // 2. Dynamic window queries using QueryBuilder
    const window1h = new Date(timestamp.getTime() - 60 * 60 * 1000);
    const window24h = new Date(timestamp.getTime() - 24 * 60 * 60 * 1000);

    const [dynamic1h, dynamic24h] = await Promise.all([
      this.repo
        .createQueryBuilder('t')
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(t.amount), 0)', 'totalAmount')
        .where('t.card_id = :cardId', { cardId })
        .andWhere('t.event_occurred_at >= :from', { from: window1h })
        .andWhere('t.event_occurred_at < :to', { to: timestamp })
        .getRawOne<{ count: string; totalAmount: string }>(),

      this.repo
        .createQueryBuilder('t')
        .select('COUNT(*)', 'count')
        .where('t.card_id = :cardId', { cardId })
        .andWhere('t.event_occurred_at >= :from', { from: window24h })
        .andWhere('t.event_occurred_at < :to', { to: timestamp })
        .getRawOne<{ count: string }>(),
    ]);

    return {
      precomputed: row ?? null,
      countLast1h: parseInt(dynamic1h?.count ?? '0', 10),
      countLast24h: parseInt(dynamic24h?.count ?? '0', 10),
      totalAmountLast1h: parseFloat(dynamic1h?.totalAmount ?? '0'),
    };
  }

  /**
   * Returns aggregate spending statistics for a customer's history,
   * excluding the current transaction (by ID) and only transactions
   * strictly before the current timestamp.
   *
   * Uses a raw query for PERCENTILE_CONT which TypeORM QueryBuilder
   * does not support natively.
   *
   * Returns null for all stats if the customer has no historical transactions.
   */
  async getCustomerSpendingStats(
    customerId: string,
    currentTransactionId: string,
    currentTimestamp: Date,
  ): Promise<{
    avgAmount: number | null;
    stddevAmount: number | null;
    p95Amount: number | null;
    transactionCount: number;
    lastTransactionAt: Date | null;
  }> {
    const raw = await this.repo.manager.query<
      Array<{
        avg_amount: string | null;
        stddev_amount: string | null;
        p95_amount: string | null;
        transaction_count: string;
        last_transaction_at: string | null;
      }>
    >(
      `SELECT
         AVG(amount)                                          AS avg_amount,
         STDDEV(amount)                                       AS stddev_amount,
         PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY amount) AS p95_amount,
         COUNT(*)                                             AS transaction_count,
         MAX(event_occurred_at)                               AS last_transaction_at
       FROM transactions
       WHERE customer_id = $1
         AND id != $2
         AND event_occurred_at < $3`,
      [customerId, currentTransactionId, currentTimestamp],
    );

    const row = raw[0];
    const count = parseInt(row?.transaction_count ?? '0', 10);

    if (count === 0) {
      return { avgAmount: null, stddevAmount: null, p95Amount: null, transactionCount: 0, lastTransactionAt: null };
    }

    return {
      avgAmount: row.avg_amount != null ? parseFloat(row.avg_amount) : null,
      stddevAmount: row.stddev_amount != null ? parseFloat(row.stddev_amount) : null,
      p95Amount: row.p95_amount != null ? parseFloat(row.p95_amount) : null,
      transactionCount: count,
      lastTransactionAt: row.last_transaction_at != null ? new Date(row.last_transaction_at) : null,
    };
  }

  /**
   * Returns the customer's historical distribution of channels and hours of day,
   * excluding the current transaction.
   *
   * Used by analyzeTransactionContext to detect unusual patterns.
   */
  async getCustomerContextStats(
    customerId: string,
    currentTransactionId: string,
  ): Promise<{
    channelDistribution: Record<string, number>;
    hourDistribution: Record<string, number>;
    totalCount: number;
  }> {
    const [channelRows, hourRows] = await Promise.all([
      this.repo
        .createQueryBuilder('t')
        .select('t.segment_channel_type', 'channel')
        .addSelect('COUNT(*)', 'count')
        .where('t.customer_id = :customerId', { customerId })
        .andWhere('t.id != :currentId', { currentId: currentTransactionId })
        .andWhere('t.segment_channel_type IS NOT NULL')
        .groupBy('t.segment_channel_type')
        .getRawMany<{ channel: string; count: string }>(),

      this.repo
        .createQueryBuilder('t')
        .select('EXTRACT(HOUR FROM t.event_occurred_at)::int', 'hour')
        .addSelect('COUNT(*)', 'count')
        .where('t.customer_id = :customerId', { customerId })
        .andWhere('t.id != :currentId', { currentId: currentTransactionId })
        .groupBy('EXTRACT(HOUR FROM t.event_occurred_at)::int')
        .getRawMany<{ hour: number; count: string }>(),
    ]);

    const channelDistribution: Record<string, number> = {};
    let totalCount = 0;
    for (const row of channelRows) {
      const n = parseInt(row.count, 10);
      channelDistribution[row.channel] = n;
      totalCount += n;
    }

    const hourDistribution: Record<string, number> = {};
    for (const row of hourRows) {
      hourDistribution[String(row.hour)] = parseInt(row.count, 10);
    }

    return { channelDistribution, hourDistribution, totalCount };
  }

  /**
   * Returns aggregate transaction statistics for a merchant (acceptor_id).
   *
   * Static risk fields (acceptorRisk, acceptorRiskyFlag, etc.) are read
   * from the target transaction row — they are per-row snapshot values, not
   * aggregates. The aggregate (count, avg, min, max amount) covers ALL
   * transactions for that merchant in the dataset.
   *
   * Returns null for all numeric aggregates if the merchant has no transactions.
   */
  async getMerchantHistory(
    acceptorId: string,
    transactionId: string,
  ): Promise<{
    totalTransactions: number;
    avgAmount: number | null;
    maxAmount: number | null;
    minAmount: number | null;
    acceptorRisk: number | null;
    acceptorRiskyFlag: number | null;
    acceptorMastercardRisk: number | null;
    acceptorVisaRisk: number | null;
  }> {
    // 1. Aggregate stats across all merchant transactions
    const agg = await this.repo
      .createQueryBuilder('t')
      .select('COUNT(*)', 'total')
      .addSelect('AVG(t.amount)', 'avg_amount')
      .addSelect('MAX(t.amount)', 'max_amount')
      .addSelect('MIN(t.amount)', 'min_amount')
      .where('t.acceptor_id = :acceptorId', { acceptorId })
      .getRawOne<{
        total: string;
        avg_amount: string | null;
        max_amount: string | null;
        min_amount: string | null;
      }>();

    // 2. Static risk fields from the target transaction row
    const row = await this.repo.findOne({
      where: { id: transactionId },
      select: ['acceptorRisk', 'acceptorRiskyFlag', 'acceptorMastercardRisk', 'acceptorVisaRisk'],
    });

    return {
      totalTransactions: parseInt(agg?.total ?? '0', 10),
      avgAmount: agg?.avg_amount != null ? parseFloat(agg.avg_amount) : null,
      maxAmount: agg?.max_amount != null ? parseFloat(agg.max_amount) : null,
      minAmount: agg?.min_amount != null ? parseFloat(agg.min_amount) : null,
      acceptorRisk: row?.acceptorRisk ?? null,
      acceptorRiskyFlag: row?.acceptorRiskyFlag ?? null,
      acceptorMastercardRisk: row?.acceptorMastercardRisk ?? null,
      acceptorVisaRisk: row?.acceptorVisaRisk ?? null,
    };
  }

  /**
   * Returns risk signals for a customer:
   *  - riskRating and malwareFlag from the target transaction row (snapshot)
   *  - declinedLast30d / declinedLast7d: dynamic counts of non-approved
   *    transactions in the last 30 and 7 days respectively.
   *
   * "Declined" = transaction_status IS NOT NULL AND transaction_status != 'approved'.
   * NULL status rows are excluded to avoid false positives from missing data.
   */
  async getCustomerRiskEvents(
    customerId: string,
    transactionId: string,
  ): Promise<{
    riskRating: string | null;
    malwareFlag: boolean | null;
    declinedLast30d: number;
    declinedLast7d: number;
  }> {
    const now = new Date();
    const window30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const window7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // 1. Snapshot fields from the target transaction row
    const row = await this.repo.findOne({
      where: { id: transactionId },
      select: ['customerRiskRating', 'malwareFlag'],
    });

    // 2. Declined counts (parallel queries)
    const [dec30, dec7] = await Promise.all([
      this.repo
        .createQueryBuilder('t')
        .select('COUNT(*)', 'count')
        .where('t.customer_id = :customerId', { customerId })
        .andWhere('t.transaction_status IS NOT NULL')
        .andWhere("t.transaction_status != 'approved'")
        .andWhere('t.event_occurred_at >= :from', { from: window30d })
        .getRawOne<{ count: string }>(),

      this.repo
        .createQueryBuilder('t')
        .select('COUNT(*)', 'count')
        .where('t.customer_id = :customerId', { customerId })
        .andWhere('t.transaction_status IS NOT NULL')
        .andWhere("t.transaction_status != 'approved'")
        .andWhere('t.event_occurred_at >= :from', { from: window7d })
        .getRawOne<{ count: string }>(),
    ]);

    return {
      riskRating: row?.customerRiskRating ?? null,
      malwareFlag: row?.malwareFlag ?? null,
      declinedLast30d: parseInt(dec30?.count ?? '0', 10),
      declinedLast7d: parseInt(dec7?.count ?? '0', 10),
    };
  }
}
