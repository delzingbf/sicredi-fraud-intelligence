# Sub-Task 2 — Plano Revisado: Inspeção do Dataset e Data Contract

**Owner:** Dev A
**Status:** ✅ concluído — 2026-11-04
**Bloqueante para:** Sub-Tasks 3, 6 e 7  
**Entregável:** `docs/data-contract.md`

> **Este plano já incorpora as descobertas da inspeção preliminar dos arquivos.**
> Os passos de "leitura" foram executados; o que resta é tomar as decisões finais,
> confirmar densidades de dados e redigir o `data-contract.md`.

---

## Arquivos de dados confirmados

| Arquivo | Tamanho | Status |
|---|---|---|
| `data/case_transacoes_cartoes_sintetico_900k.csv` | 280 MB | ✅ disponível |
| `data/dicionario_dados_case_prevencao_sicredi.xlsx` | 20 KB | ✅ disponível |
| `data/Orientacoes_case_prevencao_sicredi.txt` | 1,5 KB | ✅ disponível |

---

## Descobertas confirmadas da inspeção preliminar

### Dataset

- **Linhas:** 900.000 transações
- **Colunas:** 297
- **Separador:** `,` (vírgula)
- **Encoding:** UTF-8
- **Formato de timestamp:** ISO-8601 (`2025-03-29T22:48:50`)
- **Distribuição:** 900 fraudes (0,10%) / 899.100 legítimas (99,90%)
- **Tipos de transação:** débito 60% / crédito 40%
- **Nota do dataset:** projetado para apresentar sinais de fraude via rajadas, alta velocidade, horários concentrados, divergência geográfica e valores anômalos

### Coluna alvo — CONFIRMADA

```
feedback_label  (categoria: "alvo", tipo: boolean)
Descrição: "Rótulo: TRUE=fraude, FALSE=legítima."
```

**`feedback_label` NUNCA entra em nenhuma tabela do banco, query ou ToolResult.**
Lido diretamente do CSV apenas pelo script `scripts/evaluate.mjs`.

### Chaves confirmadas

| Chave | Coluna no CSV | Categoria |
|---|---|---|
| ID da transação | `event_external_id` OU `fdz_uuid` | evento/modelo |
| ID do cliente | `customer_id` | cliente |
| ID do cartão | `card_id` | cartão |
| ID do estabelecimento | `acceptor_id` | estabelecimento |
| ID da conta | `account_id` | conta |

> **Atenção:** o CSV não tem uma coluna chamada `transaction_id`. O PoC usava IDs mock (`TX-1001`).
> A chave real da transação a confirmar na Sub-Task 2 é `event_external_id` (string) ou `fdz_uuid` (UUID).
> Verificar nas primeiras linhas qual dos dois é o identificador único correto.

### Categorias de colunas do dicionário

O dicionário agrupa as 297 colunas em 7 categorias:

| Categoria | Quantidade aprox. | Uso para o agente |
|---|---|---|
| `evento/modelo` | ~120 | Maioria pré-autorização — verificar individualmente |
| `cliente` | ~40 | Pré-autorização — seguros |
| `cartão` | ~30 | Pré-autorização — seguros |
| `estabelecimento` | ~23 | Pré-autorização — seguros |
| `conta` | ~20 | Pré-autorização — seguros |
| `dispositivo/terminal` | ~20 | Pré-autorização — seguros |
| `alvo` | 1 (`feedback_label`) | **NUNCA expor** |

### Colunas de velocidade pré-calculadas — CONFIRMADAS

```
cardid_count_1m          (cartão)  — contagem de transações do cartão em 1 min
cp_card_prev_term_dist_1h (evento) — distância ao terminal anterior em 1h
cp_card_term_vel_1h       (evento) — velocidade cartão/terminal em 1h
```

→ **Decisão:** usar as colunas pré-calculadas diretamente. Não computar dinamicamente.

### Dados geográficos — CONFIRMADOS PRESENTES

Múltiplas fontes geográficas disponíveis:

| Coluna | Categoria | Tipo |
|---|---|---|
| `acceptor_latitude` / `acceptor_longitude` | estabelecimento | decimal |
| `terminal_latitude` / `terminal_longitude` | dispositivo/terminal | decimal |
| `terminal_ip_latitude` / `terminal_ip_longitude` | dispositivo/terminal | decimal |
| `device_ip_latitude` / `device_ip_longitude` | dispositivo/terminal | decimal |
| `customer_city` / `customer_region` | cliente | string |
| `acceptor_city` / `acceptor_region` | estabelecimento | string |
| `terminal_city` / `terminal_region` | dispositivo/terminal | string |

→ **Decisão pendente de confirmação de densidade:** verificar % de preenchimento em amostra.

### Campos pós-autorização a excluir

Campos que indicam resultado do processamento (não disponíveis antes da autorização):

```
feedback_label          — ground-truth de fraude (NUNCA expor)
fraud                   — indicador de fraude pós-fato
fraud_score             — score calculado retroativamente
mc_fraud_score          — score Mastercard pós-processamento
visa_fraud_score        — score Visa pós-processamento
action_code             — código de resposta da autorizadora
decision                — decisão pós-autorização
transaction_status      — status pós-processamento (approved/declined)
dispute_*               — contestação pós-fato (5 colunas)
approval_code           — código de aprovação pós-autorização
fdz_feedbacks           — feedback pós-evento
fdz_triggered_actions   — ações pós-evento
event_treatment_date    — data de tratamento pós-evento
```

---

## Tarefas restantes para completar a Sub-Task 2

### Tarefa 1 — Confirmar chave da transação

Verificar nas primeiras linhas qual coluna é o ID único de transação:

```powershell
# Pegar header + 5 linhas e inspecionar event_external_id e fdz_uuid
Get-Content "data\case_transacoes_cartoes_sintetico_900k.csv" -TotalCount 6 | ForEach-Object {
    $cols = $_ -split ','
    $header = (Get-Content "data\case_transacoes_cartoes_sintetico_900k.csv" -TotalCount 1) -split ','
    # Encontrar índice de event_external_id e fdz_uuid
    $idxEvt = [array]::IndexOf($header, 'event_external_id')
    $idxUuid = [array]::IndexOf($header, 'fdz_uuid')
    Write-Host "event_external_id=$($cols[$idxEvt])  fdz_uuid=$($cols[$idxUuid])"
}
```

**Resultado esperado:** uma das duas colunas terá valores únicos por linha (o ID da transação).

### Tarefa 2 — Verificar densidade dos dados geográficos

Amostrar 10.000 linhas e contar preenchimento de `acceptor_latitude`, `terminal_latitude`:

```powershell
$header = (Get-Content "data\case_transacoes_cartoes_sintetico_900k.csv" -TotalCount 1) -split ','
$idxAccLat = [array]::IndexOf($header, 'acceptor_latitude')
$idxTermLat = [array]::IndexOf($header, 'terminal_latitude')

$sample = Get-Content "data\case_transacoes_cartoes_sintetico_900k.csv" -TotalCount 10001 | Select-Object -Skip 1
$accFilled  = ($sample | ForEach-Object { ($_ -split ',')[$idxAccLat]  } | Where-Object { $_ -ne '' -and $_ -ne 'None' }).Count
$termFilled = ($sample | ForEach-Object { ($_ -split ',')[$idxTermLat] } | Where-Object { $_ -ne '' -and $_ -ne 'None' }).Count

Write-Host "acceptor_latitude preenchido: $accFilled / 10000 ($([math]::Round($accFilled/100, 1))%)"
Write-Host "terminal_latitude preenchido: $termFilled / 10000 ($([math]::Round($termFilled/100, 1))%)"
```

**Decisão:** ≥ 30% preenchido → implementar `checkGeographicConsistency`. Caso contrário → stub `status: 'unavailable'`.

### Tarefa 3 — Verificar se dados de cliente são desnormalizados

As colunas `customer_*` aparecem em cada linha de transação (repetem por cliente).
Confirmar se os valores são idênticos para o mesmo `customer_id` (dados desnormalizados)
ou variam por transação (dados de snapshot). Isso define se será criada uma tabela `customers` separada.

```powershell
# Pegar todas as linhas de um mesmo customer_id e comparar customer_name
$header = (Get-Content "data\case_transacoes_cartoes_sintetico_900k.csv" -TotalCount 1) -split ','
$idxCust = [array]::IndexOf($header, 'customer_id')
$idxName = [array]::IndexOf($header, 'customer_name')

Get-Content "data\case_transacoes_cartoes_sintetico_900k.csv" -TotalCount 10001 |
  Select-Object -Skip 1 |
  ForEach-Object { $cols = $_ -split ','; "$($cols[$idxCust])|$($cols[$idxName])" } |
  Group-Object { ($_ -split '\|')[0] } |
  Where-Object { $_.Count -gt 1 } |
  Select-Object -First 3 |
  ForEach-Object { $_.Group }
```

**Decisão esperada:** dados de cliente são desnormalizados (mesmos valores por `customer_id`) → criar tabela `customers` por deduplicação no script de importação.

### Tarefa 4 — Verificar formato exato dos valores de amount

```powershell
$header = (Get-Content "data\case_transacoes_cartoes_sintetico_900k.csv" -TotalCount 1) -split ','
$idxAmt = [array]::IndexOf($header, 'amount')
Get-Content "data\case_transacoes_cartoes_sintetico_900k.csv" -TotalCount 11 |
  Select-Object -Skip 1 |
  ForEach-Object { ($_ -split ',')[$idxAmt] }
```

**Verificar:** valores são decimais com ponto (`6.67`) ou vírgula? Inteiros (centavos)? Isso define o tipo PostgreSQL.

### Tarefa 5 — Redigir `docs/data-contract.md`

Com base em todas as descobertas acima, escrever o documento final.

---

## Mapeamento de colunas por ferramenta

### `getTransactionDetails` (P0)

| Campo no relatório | Coluna no CSV | Tipo |
|---|---|---|
| `transactionId` | `event_external_id` (confirmar) | string |
| `customerId` | `customer_id` | string |
| `amount` | `amount` | decimal |
| `timestamp` | `event_occurred_at` | ISO-8601 string |
| `type` | `tipo_transacao` | string (debito/credito) |
| `modality` | `modalidade_transacao` | string |
| `channel` | `segment_channel_type` | string |
| `cardPresent` | `card_presence_flag` | boolean |
| `merchantId` | `acceptor_id` | string |
| `merchantName` | `acceptor_name` | string |
| `merchantCity` | `acceptor_city` | string |
| `merchantRegion` | `acceptor_region` | string |
| `mcc` | `mcc` | string |
| `cardId` | `card_id` | string |

### `getCustomerProfile` (P0)

| Campo no relatório | Coluna no CSV | Tipo |
|---|---|---|
| `customerId` | `customer_id` | string |
| `name` | `customer_name` | string |
| `segment` | `customer_segment` | string |
| `riskRating` | `customer_risk_rating` | decimal |
| `city` | `customer_city` | string |
| `region` | `customer_region` | string |
| `registrationDate` | `customer_registration_date` | string |
| `totalCreditLimit` | `customer_total_credit_limit` | decimal |
| `totalBalance` | `customer_total_balance` | decimal |
| `presumedIncome` | `customer_presumed_income` | decimal |
| `onboardingScore` | `customer_onboarding_score` | decimal |
| `kycLevel` | `customer_kyc_lvl` | string |
| `numberOfCards` | `customer_number_of_cards` | string |
| `emailChangeFlag` | `customer_email_change_flag` | boolean |
| `phoneChangeFlag` | `customer_phone_change_flag` | boolean |

### `analyzeTransactionVelocity` (P1)

| Campo | Coluna no CSV | Observação |
|---|---|---|
| `countLast1m` | `cardid_count_1m` | **PRÉ-CALCULADO** — usar direto |
| `distPrevTerminal1h` | `cp_card_prev_term_dist_1h` | **PRÉ-CALCULADO** |
| `velocityTerminal1h` | `cp_card_term_vel_1h` | **PRÉ-CALCULADO** |
| Calcular dinamicamente | query por `card_id` + `event_occurred_at` | para janelas não cobertas |

### `analyzeSpendingPattern` (P1)

Requer query agregada sobre `transactions` por `customer_id`:
- `AVG(amount)`, `STDDEV(amount)`, `PERCENTILE_CONT(0.95)` — calculados na query
- Filtrar `event_occurred_at < timestamp_atual` para excluir a transação atual

### `analyzeTransactionContext` (P1)

| Campo | Coluna no CSV |
|---|---|
| Hora da transação | extraído de `event_occurred_at` |
| Dia da semana | extraído de `event_occurred_at` |
| Canal | `segment_channel_type` |
| Tipo | `tipo_transacao` |
| Modalidade | `modalidade_transacao` |
| Cartão presente | `card_presence_flag` |

Comparar contra histórico do cliente: query sobre transações passadas do mesmo `customer_id`.

### `checkMerchantHistory` (P2)

Requer query agregada por `acceptor_id`:
- `COUNT(*)`, `AVG(amount)`, `MAX(amount)` — calculados na query
- `acceptor_risk`, `acceptor_risky_flag`, `acceptor_mastercard_risk`, `acceptor_visa_risk`

### `checkCustomerRiskEvents` (P2)

| Campo | Coluna no CSV |
|---|---|
| Risk rating atual | `customer_risk_rating` |
| Histórico de transações recusadas | query `transaction_status` != 'approved' por `customer_id` |
| Flag de malware | `malware_flag` |

### `checkGeographicConsistency` (P2 — condicional)

| Campo | Coluna no CSV |
|---|---|
| Lat/lon do estabelecimento | `acceptor_latitude`, `acceptor_longitude` |
| Lat/lon do terminal | `terminal_latitude`, `terminal_longitude` |
| Lat/lon do IP do device | `device_ip_latitude`, `device_ip_longitude` |
| Cidade do cliente cadastrada | `customer_city`, `customer_region` |
| Cidade do estabelecimento | `acceptor_city`, `acceptor_region` |

**Implementar apenas se densidade geográfica ≥ 30% (Tarefa 2 acima).**

---

## Design do schema PostgreSQL (proposta)

### Tabela `transactions`

Importar apenas campos pré-autorização. `feedback_label` **não entra**.

```sql
CREATE TABLE transactions (
  id                    VARCHAR(100) PRIMARY KEY,  -- event_external_id ou fdz_uuid (confirmar)
  customer_id           VARCHAR(100) NOT NULL,
  card_id               VARCHAR(100),
  acceptor_id           VARCHAR(100),
  account_id            VARCHAR(100),
  amount                NUMERIC(14,2),
  event_occurred_at     TIMESTAMPTZ NOT NULL,
  tipo_transacao        VARCHAR(20),               -- debito | credito
  modalidade_transacao  VARCHAR(50),
  segment_channel_type  VARCHAR(50),
  card_presence_flag    BOOLEAN,
  mcc                   VARCHAR(10),
  acceptor_name         VARCHAR(200),
  acceptor_city         VARCHAR(100),
  acceptor_region       VARCHAR(10),
  acceptor_latitude     NUMERIC(9,6),
  acceptor_longitude    NUMERIC(9,6),
  acceptor_risk         NUMERIC(6,2),
  acceptor_risky_flag   BOOLEAN,
  terminal_id           VARCHAR(100),
  terminal_latitude     NUMERIC(9,6),
  terminal_longitude    NUMERIC(9,6),
  device_ip_latitude    NUMERIC(9,6),
  device_ip_longitude   NUMERIC(9,6),
  cardid_count_1m       VARCHAR(50),               -- pré-calculado de velocidade
  cp_card_prev_term_dist_1h  VARCHAR(50),          -- pré-calculado geográfico
  cp_card_term_vel_1h        VARCHAR(50),          -- pré-calculado de velocidade
  transaction_status    VARCHAR(20),
  malware_flag          BOOLEAN,
  customer_risk_rating  NUMERIC(6,2)
);
```

### Tabela `customers` (derivada por deduplicação)

```sql
CREATE TABLE customers (
  id                       VARCHAR(100) PRIMARY KEY,  -- customer_id
  name                     VARCHAR(200),
  segment                  VARCHAR(50),
  risk_rating              NUMERIC(6,2),
  city                     VARCHAR(100),
  region                   VARCHAR(10),
  registration_date        VARCHAR(50),
  total_credit_limit       NUMERIC(14,2),
  total_balance            NUMERIC(14,2),
  presumed_income          NUMERIC(14,2),
  onboarding_score         NUMERIC(6,2),
  kyc_level                VARCHAR(50),
  number_of_cards          VARCHAR(20),
  email_change_flag        BOOLEAN,
  phone_change_flag        BOOLEAN
);
```

### Índices por ferramenta

```sql
-- Busca por transação (getTransactionDetails)
-- PK já cobre

-- Busca por cliente (getCustomerProfile, analyzeSpending, analyzeContext, riskEvents)
CREATE INDEX idx_transactions_customer_id ON transactions(customer_id);

-- Velocidade temporal (analyzeTransactionVelocity)
CREATE INDEX idx_transactions_customer_time ON transactions(customer_id, event_occurred_at DESC);

-- Histórico do estabelecimento (checkMerchantHistory)
CREATE INDEX idx_transactions_acceptor_id ON transactions(acceptor_id);

-- Status para riskEvents
CREATE INDEX idx_transactions_customer_status ON transactions(customer_id, transaction_status);
```

---

## Campos excluídos da importação (allowlist negativa)

Os seguintes campos **nunca entram no banco** e nunca aparecem em `ToolResult`:

```
feedback_label, fraud, fraud_score, mc_fraud_score, visa_fraud_score,
action_code, decision, approval_code, fdz_feedbacks, fdz_triggered_actions,
event_treatment_date, dispute_end_date, dispute_feedback_notes, dispute_notes,
dispute_reason, dispute_refunded, dispute_start_date, dispute_submitted_by
```

---

## Checklist de execução

```
[x] Leitura do header do CSV — 297 colunas confirmadas, separador ","
[x] Leitura do dicionário .xlsx — categorias e tipos de todos os campos
[x] Leitura do arquivo de orientações — distribuição e contexto de fraude confirmados
[x] Confirmação de feedback_label — boolean, TRUE=fraude, FALSE=legítima
[x] Identificação das colunas de velocidade pré-calculadas
[x] Identificação dos campos geográficos disponíveis
[x] Identificação das colunas pós-autorização a excluir
[x] Mapeamento de colunas para todas as 9 ferramentas
[x] Design do schema PostgreSQL (tabelas + índices)
[x] Tarefa 1 — Confirmar nome exato da chave da transação → event_external_id (EVT_SYN_XXXXXXXXX)
[x] Tarefa 2 — Verificar densidade dos dados geográficos → ~23,9% < 30% → stub
[x] Tarefa 3 — Confirmar se dados de cliente são desnormalizados → variam por transação → sem tabela separada
[x] Tarefa 4 — Confirmar formato de amount → decimal com ponto (6.67) → NUMERIC(14,2)
[x] Tarefa 5 — Redigir docs/data-contract.md
[ ] Revisão coletiva com todos os devs
```

---

## Decisões já tomadas

| Decisão | Resultado |
|---|---|
| Chave alvo | `feedback_label` — boolean, TRUE=fraude |
| Separador do CSV | `,` (vírgula) |
| Encoding | UTF-8 |
| Formato de timestamp | ISO-8601 (`event_occurred_at`) |
| Colunas de velocidade | Usar pré-calculadas (`cardid_count_1m`, `cp_card_prev_term_dist_1h`, `cp_card_term_vel_1h`) |
| Tabela para `feedback_label` | **Não importar para o banco** — lido do CSV só em `evaluate.mjs` |
| Tipo de transação | `tipo_transacao` (debito/credito) + `modalidade_transacao` |

## Decisões confirmadas (tarefas 1–4 executadas)

| Decisão | Resultado |
|---|---|
| Qual coluna é o ID único da transação | `event_external_id` (EVT_SYN_XXXXXXXXX) |
| `checkGeographicConsistency` implementada ou stub | **Stub** — densidade ~23,9% < 30% |
| Tabela `customers` separada ou só `transactions` | **Sem tabela separada** — dados variam por transação |
| Tipo PostgreSQL de `amount` (NUMERIC vs INTEGER) | **`NUMERIC(14,2)`** — decimal com ponto |

---

## Output final

| Arquivo | Descrição |
|---|---|
| `docs/data-contract.md` | Documento completo com campos confirmados, schema, decisões |

Nenhum código é produzido nesta sub-task.
