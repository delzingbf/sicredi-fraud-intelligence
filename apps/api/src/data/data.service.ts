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
}
