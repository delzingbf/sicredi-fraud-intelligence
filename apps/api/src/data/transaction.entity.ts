import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Transformer for NUMERIC PostgreSQL columns.
 * The pg driver returns NUMERIC as a string; this converts it to number | null.
 */
const numericTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value != null ? parseFloat(value) : null),
};

/**
 * TypeORM entity mapping the `transactions` table.
 *
 * Security: `feedback_label` and all post-authorisation fields are intentionally
 * absent — this is the structural guarantee that they can never be returned in
 * any tool result.
 */
@Entity('transactions')
export class Transaction {
  // ── Identifiers ────────────────────────────────────────────────────────────

  /** event_external_id — canonical transaction identifier */
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 100 })
  id: string;

  @Column({ name: 'customer_id', type: 'varchar', length: 100 })
  customerId: string;

  @Column({ name: 'card_id', type: 'varchar', length: 100, nullable: true })
  cardId: string | null;

  @Column({ name: 'acceptor_id', type: 'varchar', length: 100, nullable: true })
  acceptorId: string | null;

  @Column({ name: 'account_id', type: 'varchar', length: 100, nullable: true })
  accountId: string | null;

  @Column({ name: 'terminal_id', type: 'varchar', length: 100, nullable: true })
  terminalId: string | null;

  // ── Amount and time ────────────────────────────────────────────────────────

  @Column({
    name: 'amount',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  amount: number | null;

  @Column({ name: 'event_occurred_at', type: 'timestamptz' })
  eventOccurredAt: Date;

  // ── Type and channel ───────────────────────────────────────────────────────

  /** debito | credito */
  @Column({ name: 'tipo_transacao', type: 'varchar', length: 20, nullable: true })
  tipoTransacao: string | null;

  @Column({ name: 'modalidade_transacao', type: 'varchar', length: 50, nullable: true })
  modalidadeTransacao: string | null;

  @Column({ name: 'segment_channel_type', type: 'varchar', length: 50, nullable: true })
  segmentChannelType: string | null;

  @Column({ name: 'card_presence_flag', type: 'boolean', nullable: true })
  cardPresenceFlag: boolean | null;

  @Column({ name: 'mcc', type: 'varchar', length: 10, nullable: true })
  mcc: string | null;

  // ── Merchant ───────────────────────────────────────────────────────────────

  @Column({ name: 'acceptor_name', type: 'varchar', length: 200, nullable: true })
  acceptorName: string | null;

  @Column({ name: 'acceptor_city', type: 'varchar', length: 100, nullable: true })
  acceptorCity: string | null;

  @Column({ name: 'acceptor_region', type: 'varchar', length: 10, nullable: true })
  acceptorRegion: string | null;

  @Column({
    name: 'acceptor_latitude',
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  acceptorLatitude: number | null;

  @Column({
    name: 'acceptor_longitude',
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  acceptorLongitude: number | null;

  @Column({
    name: 'acceptor_risk',
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  acceptorRisk: number | null;

  @Column({
    name: 'acceptor_risky_flag',
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  acceptorRiskyFlag: number | null;

  @Column({
    name: 'acceptor_mastercard_risk',
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  acceptorMastercardRisk: number | null;

  @Column({
    name: 'acceptor_visa_risk',
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  acceptorVisaRisk: number | null;

  // ── Terminal / device ──────────────────────────────────────────────────────

  @Column({
    name: 'terminal_latitude',
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  terminalLatitude: number | null;

  @Column({
    name: 'terminal_longitude',
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  terminalLongitude: number | null;

  @Column({
    name: 'device_ip_latitude',
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  deviceIpLatitude: number | null;

  @Column({
    name: 'device_ip_longitude',
    type: 'numeric',
    precision: 9,
    scale: 6,
    nullable: true,
    transformer: numericTransformer,
  })
  deviceIpLongitude: number | null;

  // ── Pre-calculated velocity fields ─────────────────────────────────────────

  @Column({ name: 'cardid_count_1m', type: 'varchar', length: 50, nullable: true })
  cardidCount1m: string | null;

  @Column({ name: 'cp_card_prev_term_dist_1h', type: 'varchar', length: 50, nullable: true })
  cpCardPrevTermDist1h: string | null;

  @Column({ name: 'cp_card_term_vel_1h', type: 'varchar', length: 50, nullable: true })
  cpCardTermVel1h: string | null;

  // ── Risk and flags ─────────────────────────────────────────────────────────

  @Column({ name: 'transaction_status', type: 'varchar', length: 20, nullable: true })
  transactionStatus: string | null;

  @Column({ name: 'malware_flag', type: 'boolean', nullable: true })
  malwareFlag: boolean | null;

  /** Categorical risk rating: 'baixo' | 'medio' | 'alto' */
  @Column({ name: 'customer_risk_rating', type: 'varchar', length: 20, nullable: true })
  customerRiskRating: string | null;

  // ── Customer snapshot (varies per transaction — no separate customers table) ──

  @Column({ name: 'customer_name', type: 'varchar', length: 200, nullable: true })
  customerName: string | null;

  @Column({ name: 'customer_segment', type: 'varchar', length: 50, nullable: true })
  customerSegment: string | null;

  @Column({ name: 'customer_city', type: 'varchar', length: 100, nullable: true })
  customerCity: string | null;

  @Column({ name: 'customer_region', type: 'varchar', length: 10, nullable: true })
  customerRegion: string | null;

  @Column({ name: 'customer_registration_date', type: 'varchar', length: 50, nullable: true })
  customerRegistrationDate: string | null;

  @Column({
    name: 'customer_total_credit_limit',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  customerTotalCreditLimit: number | null;

  @Column({
    name: 'customer_total_balance',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  customerTotalBalance: number | null;

  @Column({
    name: 'customer_presumed_income',
    type: 'numeric',
    precision: 14,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  customerPresumedIncome: number | null;

  @Column({
    name: 'customer_onboarding_score',
    type: 'numeric',
    precision: 6,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  customerOnboardingScore: number | null;

  @Column({ name: 'customer_kyc_lvl', type: 'varchar', length: 50, nullable: true })
  customerKycLvl: string | null;

  @Column({ name: 'customer_number_of_cards', type: 'varchar', length: 20, nullable: true })
  customerNumberOfCards: string | null;

  @Column({ name: 'customer_email_change_flag', type: 'boolean', nullable: true })
  customerEmailChangeFlag: boolean | null;

  @Column({ name: 'customer_phone_change_flag', type: 'boolean', nullable: true })
  customerPhoneChangeFlag: boolean | null;
}
