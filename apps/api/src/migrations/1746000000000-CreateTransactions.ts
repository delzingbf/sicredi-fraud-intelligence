import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransactions1746000000000 implements MigrationInterface {
  name = 'CreateTransactions1746000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE transactions (
        -- Identifiers
        id                          VARCHAR(100) PRIMARY KEY,
        customer_id                 VARCHAR(100) NOT NULL,
        card_id                     VARCHAR(100),
        acceptor_id                 VARCHAR(100),
        account_id                  VARCHAR(100),
        terminal_id                 VARCHAR(100),

        -- Amount and time
        amount                      NUMERIC(14,2),
        event_occurred_at           TIMESTAMPTZ NOT NULL,

        -- Type and channel
        tipo_transacao              VARCHAR(20),
        modalidade_transacao        VARCHAR(50),
        segment_channel_type        VARCHAR(50),
        card_presence_flag          BOOLEAN,
        mcc                         VARCHAR(10),

        -- Merchant
        acceptor_name               VARCHAR(200),
        acceptor_city               VARCHAR(100),
        acceptor_region             VARCHAR(10),
        acceptor_latitude           NUMERIC(9,6),
        acceptor_longitude          NUMERIC(9,6),
        acceptor_risk               NUMERIC(6,2),
        acceptor_risky_flag         NUMERIC(6,2),
        acceptor_mastercard_risk    NUMERIC(6,2),
        acceptor_visa_risk          NUMERIC(6,2),

        -- Terminal / device
        terminal_latitude           NUMERIC(9,6),
        terminal_longitude          NUMERIC(9,6),
        device_ip_latitude          NUMERIC(9,6),
        device_ip_longitude         NUMERIC(9,6),

        -- Pre-calculated velocity
        cardid_count_1m             VARCHAR(50),
        cp_card_prev_term_dist_1h   VARCHAR(50),
        cp_card_term_vel_1h         VARCHAR(50),

        -- Risk and flags
        transaction_status          VARCHAR(20),
        malware_flag                BOOLEAN,
        customer_risk_rating        VARCHAR(20),

        -- Customer snapshot
        customer_name               VARCHAR(200),
        customer_segment            VARCHAR(50),
        customer_city               VARCHAR(100),
        customer_region             VARCHAR(10),
        customer_registration_date  VARCHAR(50),
        customer_total_credit_limit NUMERIC(14,2),
        customer_total_balance      NUMERIC(14,2),
        customer_presumed_income    NUMERIC(14,2),
        customer_onboarding_score   NUMERIC(6,2),
        customer_kyc_lvl            VARCHAR(50),
        customer_number_of_cards    VARCHAR(20),
        customer_email_change_flag  BOOLEAN,
        customer_phone_change_flag  BOOLEAN
      )
    `);

    await queryRunner.query(
      `CREATE INDEX idx_transactions_customer_id ON transactions(customer_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_transactions_customer_time ON transactions(customer_id, event_occurred_at DESC)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_transactions_acceptor_id ON transactions(acceptor_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX idx_transactions_customer_status ON transactions(customer_id, transaction_status)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS transactions`);
  }
}
