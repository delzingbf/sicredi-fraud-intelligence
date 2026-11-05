# Data Contract — FraudLens / Sicredi Fraud Intelligence

**Owner:** Dev A  
**Status:** ✅ Finalizado  
**Gerado em:** Sub-Task 2  
**Bloqueante resolvido para:** Sub-Tasks 3, 6 e 7

---

## 1. Fonte de dados

| Arquivo | Tamanho | Formato |
|---|---|---|
| `data/case_transacoes_cartoes_sintetico_900k.csv` | ~280 MB | CSV UTF-8, separador `,` |
| `data/dicionario_dados_case_prevencao_sicredi.xlsx` | ~20 KB | XLSX |
| `data/Orientacoes_case_prevencao_sicredi.txt` | ~1,5 KB | TXT |

### Características do dataset

| Propriedade | Valor |
|---|---|
| Linhas | 900.000 transações |
| Colunas | 297 |
| Separador | `,` (vírgula) |
| Encoding | UTF-8 |
| Formato de timestamp | ISO-8601 — `event_occurred_at` ex: `2025-03-29T22:48:50` |
| Distribuição de fraude | 900 fraudes (0,10%) / 899.100 legítimas (99,90%) |
| Tipos de transação | débito ~60% / crédito ~40% |

---

## 2. Decisões confirmadas pela inspeção

### 2.1 Chave primária da transação

**Coluna:** `event_external_id`  
**Formato:** `EVT_SYN_XXXXXXXXX` (string, índice sequencial)  
**Motivo da escolha:** `fdz_uuid` usa formato `UUID-SYN-XXXXXXXXX` (string não-UUID padrão);
ambas são sequenciais e únicas, mas `event_external_id` é o identificador de evento canônico
segundo o dicionário de dados.

> `fdz_uuid` também está disponível e é único, mas `event_external_id` é usado como PK.

### 2.2 Dados geográficos — stub

**Densidade medida (amostra de 10.000 linhas):**

| Coluna | Preenchida | % |
|---|---|---|
| `acceptor_latitude` | ~2.394 | **~23,9%** |
| `terminal_latitude` | ~2.390 | **~23,9%** |

**Decisão:** densidade < 30% → `checkGeographicConsistency` implementada como **stub**
que retorna `status: 'unavailable'` com `message: 'Geographic data insufficient (< 30% fill rate)'`.

### 2.3 Dados de cliente — snapshot por transação (sem tabela separada)

A inspeção mostrou que campos como `customer_city` e `customer_segment` **variam entre
transações do mesmo `customer_id`**. Os dados de cliente são snapshots no momento de cada
transação, não dados estáticos de cadastro.

**Decisão:** **não criar tabela `customers` separada**. Todos os campos `customer_*`
ficam na tabela `transactions`. O `DataService` lê o perfil do cliente a partir da
**transação mais recente** para `getCustomerProfile`.

### 2.4 Formato do campo `amount`

**Formato confirmado:** decimal com ponto — ex: `6.67`, `97.66`, `106.92`  
**Tipo PostgreSQL:** `NUMERIC(14,2)`

### 2.5 Campo alvo — `feedback_label`

**Tipo:** boolean (`TRUE` = fraude, `FALSE` = legítima)  
**Regra inviolável:** `feedback_label` **nunca entra no banco de dados**, nunca aparece
em nenhuma query SQL, e nunca é incluído em nenhum `ToolResult`.  
**Único uso permitido:** leitura direta do CSV no script `scripts/evaluate.mjs`.

---

## 3. Schema PostgreSQL

> **Nota:** `synchronize: false` no TypeORM — schema aplicado apenas via migrations.

### 3.1 Tabela `transactions`

```sql
CREATE TABLE transactions (
  -- Identificadores
  id                         VARCHAR(100) PRIMARY KEY,  -- event_external_id
  customer_id                VARCHAR(100) NOT NULL,
  card_id                    VARCHAR(100),
  acceptor_id                VARCHAR(100),
  account_id                 VARCHAR(100),
  terminal_id                VARCHAR(100),

  -- Valores e tempo
  amount                     NUMERIC(14,2),
  event_occurred_at          TIMESTAMPTZ NOT NULL,

  -- Tipo e canal
  tipo_transacao             VARCHAR(20),               -- debito | credito
  modalidade_transacao       VARCHAR(50),
  segment_channel_type       VARCHAR(50),
  card_presence_flag         BOOLEAN,
  mcc                        VARCHAR(10),

  -- Estabelecimento
  acceptor_name              VARCHAR(200),
  acceptor_city              VARCHAR(100),
  acceptor_region            VARCHAR(10),
  acceptor_latitude          NUMERIC(9,6),
  acceptor_longitude         NUMERIC(9,6),
  acceptor_risk              NUMERIC(6,2),
  acceptor_risky_flag        BOOLEAN,
  acceptor_mastercard_risk   NUMERIC(6,2),
  acceptor_visa_risk         NUMERIC(6,2),

  -- Terminal / dispositivo
  terminal_latitude          NUMERIC(9,6),
  terminal_longitude         NUMERIC(9,6),
  device_ip_latitude         NUMERIC(9,6),
  device_ip_longitude        NUMERIC(9,6),

  -- Velocidade pré-calculada
  cardid_count_1m            VARCHAR(50),
  cp_card_prev_term_dist_1h  VARCHAR(50),
  cp_card_term_vel_1h        VARCHAR(50),

  -- Risco e flags
  transaction_status         VARCHAR(20),
  malware_flag               BOOLEAN,
  customer_risk_rating        VARCHAR(20),               -- baixo | medio | alto

  -- Snapshot do cliente (varia por transação — sem tabela separada)
  customer_name              VARCHAR(200),
  customer_segment           VARCHAR(50),
  customer_city              VARCHAR(100),
  customer_region            VARCHAR(10),
  customer_registration_date VARCHAR(50),
  customer_total_credit_limit NUMERIC(14,2),
  customer_total_balance     NUMERIC(14,2),
  customer_presumed_income   NUMERIC(14,2),
  customer_onboarding_score  NUMERIC(6,2),
  customer_kyc_lvl           VARCHAR(50),
  customer_number_of_cards   VARCHAR(20),
  customer_email_change_flag BOOLEAN,
  customer_phone_change_flag BOOLEAN
);
```

### 3.2 Índices

```sql
-- Busca por transação: coberta pela PK

-- Busca por cliente (getCustomerProfile, analyzeSpending, analyzeContext, riskEvents)
CREATE INDEX idx_transactions_customer_id
  ON transactions(customer_id);

-- Velocidade temporal (analyzeTransactionVelocity)
CREATE INDEX idx_transactions_customer_time
  ON transactions(customer_id, event_occurred_at DESC);

-- Histórico do estabelecimento (checkMerchantHistory)
CREATE INDEX idx_transactions_acceptor_id
  ON transactions(acceptor_id);

-- Status para checkCustomerRiskEvents
CREATE INDEX idx_transactions_customer_status
  ON transactions(customer_id, transaction_status);
```

---

## 4. Campos excluídos da importação

Os seguintes campos **nunca são importados** para o banco e **nunca aparecem** em `ToolResult`:

| Campo | Motivo |
|---|---|
| `feedback_label` | Ground-truth de fraude — uso exclusivo de `evaluate.mjs` |
| `fraud` | Indicador pós-fato |
| `fraud_score` | Score calculado retroativamente |
| `mc_fraud_score` | Score Mastercard pós-processamento |
| `visa_fraud_score` | Score Visa pós-processamento |
| `action_code` | Código de resposta da autorizadora |
| `decision` | Decisão pós-autorização |
| `approval_code` | Código de aprovação pós-autorização |
| `fdz_feedbacks` | Feedback pós-evento |
| `fdz_triggered_actions` | Ações pós-evento |
| `event_treatment_date` | Data de tratamento pós-evento |
| `dispute_end_date` | Contestação pós-fato |
| `dispute_feedback_notes` | Contestação pós-fato |
| `dispute_notes` | Contestação pós-fato |
| `dispute_reason` | Contestação pós-fato |
| `dispute_refunded` | Contestação pós-fato |
| `dispute_start_date` | Contestação pós-fato |
| `dispute_submitted_by` | Contestação pós-fato |

---

## 5. Mapeamento de colunas por ferramenta

### 5.1 `getTransactionDetails` (P0)

| Campo retornado | Coluna no CSV | Tipo PostgreSQL |
|---|---|---|
| `transactionId` | `event_external_id` | VARCHAR(100) PK |
| `customerId` | `customer_id` | VARCHAR(100) |
| `amount` | `amount` | NUMERIC(14,2) |
| `timestamp` | `event_occurred_at` | TIMESTAMPTZ |
| `type` | `tipo_transacao` | VARCHAR(20) |
| `modality` | `modalidade_transacao` | VARCHAR(50) |
| `channel` | `segment_channel_type` | VARCHAR(50) |
| `cardPresent` | `card_presence_flag` | BOOLEAN |
| `merchantId` | `acceptor_id` | VARCHAR(100) |
| `merchantName` | `acceptor_name` | VARCHAR(200) |
| `merchantCity` | `acceptor_city` | VARCHAR(100) |
| `merchantRegion` | `acceptor_region` | VARCHAR(10) |
| `mcc` | `mcc` | VARCHAR(10) |
| `cardId` | `card_id` | VARCHAR(100) |

**Query:** `SELECT ... FROM transactions WHERE id = $1`

### 5.2 `getCustomerProfile` (P0)

| Campo retornado | Coluna no CSV | Tipo PostgreSQL |
|---|---|---|
| `customerId` | `customer_id` | VARCHAR(100) |
| `name` | `customer_name` | VARCHAR(200) |
| `segment` | `customer_segment` | VARCHAR(50) |
| `riskRating` | `customer_risk_rating` | NUMERIC(6,2) |
| `city` | `customer_city` | VARCHAR(100) |
| `region` | `customer_region` | VARCHAR(10) |
| `registrationDate` | `customer_registration_date` | VARCHAR(50) |
| `totalCreditLimit` | `customer_total_credit_limit` | NUMERIC(14,2) |
| `totalBalance` | `customer_total_balance` | NUMERIC(14,2) |
| `presumedIncome` | `customer_presumed_income` | NUMERIC(14,2) |
| `onboardingScore` | `customer_onboarding_score` | NUMERIC(6,2) |
| `kycLevel` | `customer_kyc_lvl` | VARCHAR(50) |
| `numberOfCards` | `customer_number_of_cards` | VARCHAR(20) |
| `emailChangeFlag` | `customer_email_change_flag` | BOOLEAN |
| `phoneChangeFlag` | `customer_phone_change_flag` | BOOLEAN |

**Query:** `SELECT ... FROM transactions WHERE customer_id = $1 ORDER BY event_occurred_at DESC LIMIT 1`  
_(lê o snapshot mais recente do cliente)_

### 5.3 `analyzeTransactionVelocity` (P1)

| Campo retornado | Fonte | Observação |
|---|---|---|
| `countLast1m` | `cardid_count_1m` | **Pré-calculado** — leitura direta |
| `distPrevTerminal1h` | `cp_card_prev_term_dist_1h` | **Pré-calculado** — leitura direta |
| `velocityTerminal1h` | `cp_card_term_vel_1h` | **Pré-calculado** — leitura direta |
| `countLast1h` | query dinâmica | `COUNT(*) WHERE card_id=$1 AND event_occurred_at BETWEEN $ts-1h AND $ts` |
| `countLast24h` | query dinâmica | `COUNT(*) WHERE card_id=$1 AND event_occurred_at BETWEEN $ts-24h AND $ts` |
| `totalAmountLast1h` | query dinâmica | `SUM(amount)` mesma janela |

### 5.4 `analyzeSpendingPattern` (P1)

Query agregada sobre `transactions` por `customer_id`, excluindo a transação atual:

```sql
SELECT
  AVG(amount)                                    AS avg_amount,
  STDDEV(amount)                                 AS stddev_amount,
  PERCENTILE_CONT(0.95) WITHIN GROUP
    (ORDER BY amount)                            AS p95_amount,
  COUNT(*)                                       AS transaction_count,
  MAX(event_occurred_at)                         AS last_transaction_at
FROM transactions
WHERE customer_id = $1
  AND id != $2
  AND event_occurred_at < $3;
```

### 5.5 `analyzeTransactionContext` (P1)

| Campo retornado | Fonte |
|---|---|
| Hora da transação | extraído de `event_occurred_at` |
| Dia da semana | extraído de `event_occurred_at` |
| Canal | `segment_channel_type` |
| Tipo | `tipo_transacao` |
| Modalidade | `modalidade_transacao` |
| Cartão presente | `card_presence_flag` |
| Padrão horário histórico | query `COUNT(*) GROUP BY EXTRACT(HOUR FROM event_occurred_at)` |
| Canais históricos | query `COUNT(*) GROUP BY segment_channel_type` |

### 5.6 `checkMerchantHistory` (P2)

Query agregada por `acceptor_id`:

```sql
SELECT
  COUNT(*)        AS total_transactions,
  AVG(amount)     AS avg_amount,
  MAX(amount)     AS max_amount,
  MIN(amount)     AS min_amount,
  -- Static risk fields from the target transaction row:
  acceptor_risk,
  acceptor_risky_flag,
  acceptor_mastercard_risk,
  acceptor_visa_risk
FROM transactions
WHERE acceptor_id = $1;
```

### 5.7 `checkCustomerRiskEvents` (P2)

| Campo retornado | Fonte |
|---|---|
| `riskRating` | `customer_risk_rating` (da transação atual) |
| `malwareFlag` | `malware_flag` (da transação atual) |
| `declinedLast30d` | `COUNT(*) WHERE customer_id=$1 AND transaction_status != 'approved' AND event_occurred_at > NOW()-30d` |
| `declinedLast7d` | mesmo com janela de 7d |

### 5.8 `checkGeographicConsistency` (P2 — stub)

**Status: STUB** — densidade geográfica ~24% (abaixo do limiar de 30%).

```typescript
// Implementação como stub em tools/check-geographic-consistency.tool.ts
return {
  status: 'unavailable',
  data: null,
  metadata: {
    tool: 'checkGeographicConsistency',
    dataSource: 'stub',
    missingFields: ['acceptor_latitude', 'terminal_latitude'],
  },
  message: 'Geographic data insufficient (fill rate ~24%, threshold 30%)',
};
```

### 5.9 `getRiskPolicy` (estático)

Sem acesso a banco. Retorna configuração estática definida em código.

---

## 6. Convenções de nomenclatura

| Contexto | Convenção |
|---|---|
| Coluna CSV | `snake_case` (ex: `event_occurred_at`) |
| Coluna PostgreSQL | idêntica ao CSV |
| Campo em `ToolResult` | `camelCase` (ex: `eventOccurredAt`) |
| Entidade TypeORM | `PascalCase` (ex: `Transaction`) |
| Propriedade de entidade | `camelCase` com `@Column({ name: 'snake_case' })` |

---

## 7. Regras de segurança (resumo)

1. **`feedback_label` nunca entra no banco** — sem exceções.
2. **Campos pós-autorização** (lista na seção 4) nunca entram no banco.
3. **`DataService`** nunca expõe `feedback_label` em nenhum método.
4. **ToolResult** nunca contém campos da lista de exclusão.
5. **Script de avaliação** (`scripts/evaluate.mjs`) é o **único** lugar autorizado a ler `feedback_label` do CSV.

---

## 8. Resumo das decisões

| Decisão | Resultado |
|---|---|
| Chave da transação | `event_external_id` (EVT_SYN_XXXXXXXXX) |
| Chave do cliente | `customer_id` (CUST_SYN_XXXXXXX) |
| Chave do estabelecimento | `acceptor_id` |
| Chave do cartão | `card_id` |
| Chave da conta | `account_id` |
| Tabela `customers` separada | **Não** — dados de cliente variam por transação (snapshot) |
| Tipo de `amount` | `NUMERIC(14,2)` — decimal com ponto |
| `checkGeographicConsistency` | **Stub** — densidade ~24% < limiar 30% |
| Colunas de velocidade | Usar pré-calculadas (`cardid_count_1m`, `cp_card_prev_term_dist_1h`, `cp_card_term_vel_1h`) |
| `feedback_label` no banco | **Nunca** |
| Separador CSV | `,` (vírgula) |
| Encoding | UTF-8 |
| Formato de timestamp | ISO-8601 → `TIMESTAMPTZ` no PostgreSQL |

---

## 9. Correções descobertas na importação (Sub-Task 3 — 2026-11-05)

Durante a execução do `scripts/import-csv.mjs` foram encontradas divergências entre
o schema planejado e os valores reais do CSV. Todas foram corrigidas na migration,
no entity TypeORM e neste documento.

| Coluna | Tipo planejado | Tipo real no CSV | Tipo final no banco |
|---|---|---|---|
| `acceptor_risky_flag` | `BOOLEAN` | Numérico float (`27.76`, `19.04`, …) | `NUMERIC(6,2)` |
| `customer_risk_rating` | `NUMERIC(6,2)` | Categórico string (`baixo`, `medio`, `alto`) | `VARCHAR(20)` |
| `card_presence_flag` | `BOOLEAN` (`true`/`false`) | String `Y`/`N` | `BOOLEAN` — normalizado no script |
| `malware_flag` | `BOOLEAN` (`true`/`false`) | String `True`/`False` | `BOOLEAN` — normalizado no script |

**Mapeamento de nome de coluna:**
- Coluna no CSV: `event_external_id` → coluna no banco: `id` (tratado via `CSV_COLUMN_ALIAS` no script)

**Linhas puladas na importação:**
- ~1.299 linhas têm `event_occurred_at = 'None'` ou `customer_id = 'None'` (campos NOT NULL)
- Essas linhas são silenciosamente ignoradas pelo script

**Tamanho real do dataset:**
- Arquivo rotulado "900k" contém **160.000 linhas** na distribuição atual
- 158.701 linhas importadas com sucesso
