# Dev A — Responsabilidades e Entregáveis

**Área:** Dados e Ferramentas  
**Projeto:** FraudLens — Sicredi Fraud Intelligence (Hello Moto)

---

## Visão geral

Dev A é responsável por toda a camada de dados do sistema: inspecionar o dataset
sintético, definir o schema do banco, importar os dados, implementar o `DataService`
e construir as ferramentas que o agente AI usa para investigar transações.

Nenhuma ferramenta real pode ser construída sem a conclusão da Sub-Task 2
(`docs/data-contract.md`). A ordem abaixo é obrigatória.

---

## Ordem de execução

```
Sub-Task 2  →  Sub-Task 3  →  Sub-Task 6  →  Sub-Task 7 (parcial)
```

---

## Sub-Task 2 — Inspeção do Dataset e Data Contract

**Bloqueante para todas as demais.** Produz o documento de referência
`docs/data-contract.md` que todos os devs revisam antes de qualquer codificação
de banco ou ferramentas.

### Entradas

| Arquivo | Conteúdo |
|---|---|
| `data/case_transacoes_cartoes_sintetico_900k.csv` | 900k transações sintéticas, 297 colunas |
| `data/dicionario_dados_case_prevencao_sicredi.xlsx` | Dicionário de dados (usar `office_read`) |
| `data/Orientacoes_case_prevencao_sicredi.txt` | Orientações do desafio |

### Passos

1. Ler **apenas o header** do CSV (primeira linha) — não carregar as 900k linhas
2. Ler o dicionário de dados (`.xlsx`) com `office_read` para entender o significado de cada coluna
3. Ler o arquivo de orientações para contexto adicional
4. Para cada uma das 10 ferramentas planejadas, mapear quais colunas são necessárias
5. Separar campos em dois grupos:
   - **Pré-autorização** → seguros para expor ao agente
   - **Pós-autorização** → devem ser **excluídos** de todos os resultados de ferramentas
6. Confirmar o nome exato da coluna de ground-truth (`feedback_label`) e seus valores esperados (`TRUE`/`FALSE`)
7. Avaliar colunas geográficas (lat/lon, cidade): existem? têm taxa de preenchimento adequada?
8. Avaliar colunas de velocidade: há valores pré-calculados (ex.: `cardid_count_1m`) ou precisam ser calculados dinamicamente por query?
9. Desenhar o schema PostgreSQL:
   - Quais colunas vão para quais tabelas
   - Quais índices são necessários por ferramenta (chaves: `transaction_id`, `customer_id`, `merchant_id`)
10. Escrever `docs/data-contract.md` com todas as descobertas

### Saída

**`docs/data-contract.md`** contendo:
- Nomes de colunas confirmados para cada ferramenta
- Lista de campos pré-autorização (permitidos)
- Lista de campos pós-autorização (bloqueados)
- Nome exato e valores de `feedback_label`
- Avaliação dos dados geográficos
- Avaliação das colunas de velocidade (pré-calculado vs. dinâmico)
- Design das tabelas e índices do PostgreSQL

**Owner:** Dev A (primário) — todos os devs revisam antes de prosseguir para a Sub-Task 3.

---

## Sub-Task 3 — DataService e as 2 Ferramentas Fundamentais (P0)

**Status:** ✅ Concluída — 2026-11-05
**Depende de:** `docs/data-contract.md` estar completo e revisado.

### Entregáveis produzidos

| Arquivo | Descrição |
|---|---|
| `apps/api/src/data/transaction.entity.ts` | Entidade TypeORM — 45 colunas, `feedback_label` ausente estruturalmente |
| `apps/api/src/migrations/1746000000000-CreateTransactions.ts` | CREATE TABLE transactions + 4 índices |
| `apps/api/src/data-source.ts` | DataSource standalone para o CLI do TypeORM |
| `apps/api/src/data/data.service.ts` | `getTransactionById()`, `getLatestCustomerSnapshot()` |
| `apps/api/src/data/data.module.ts` | TypeOrmModule.forRootAsync + exporta DataService |
| `apps/api/src/tools/get-transaction-details.tool.ts` | Ferramenta real — substitui mock via OnModuleInit |
| `apps/api/src/tools/get-customer-profile.tool.ts` | Ferramenta real — substitui mock via OnModuleInit |
| `apps/api/src/tools/tools.module.ts` | ToolsModule importado pelo AppModule |
| `scripts/import-csv.mjs` | Importação streaming via COPY, idempotente — 158.701 linhas carregadas |
| `apps/api/src/data/data.service.spec.ts` | Testes unitários do DataService |
| `apps/api/src/tools/get-transaction-details.tool.spec.ts` | Testes unitários da ferramenta |
| `apps/api/src/tools/get-customer-profile.tool.spec.ts` | Testes unitários da ferramenta |

### Correções de schema descobertas na importação

O CSV revelou divergências em relação ao plano original — corrigidas no entity, migration e data-contract.md:

| Coluna | Tipo planejado | Tipo real no CSV | Correção aplicada |
|---|---|---|---|
| `acceptor_risky_flag` | `BOOLEAN` | Numérico (`27.76`) | `NUMERIC(6,2)` |
| `customer_risk_rating` | `NUMERIC(6,2)` | Categórico (`baixo`/`medio`/`alto`) | `VARCHAR(20)` |
| `card_presence_flag` | `BOOLEAN` (true/false) | String `Y`/`N` | Normalizado no script |
| `malware_flag` | `BOOLEAN` (true/false) | String `True`/`False` | Normalizado no script |
| `id` (DB) | `event_external_id` (CSV) | Nomes diferentes | `CSV_COLUMN_ALIAS` no script |

Linhas com `event_occurred_at = None` ou `customer_id = None` (~1.299 de 160.000) são puladas no import.

> **Nota:** o arquivo rotulado "900k" contém 160.000 linhas na distribuição atual.

### Validação end-to-end

```
POST /investigations { "transactionId": "EVT_SYN_000000001" }
→ riskLevel: HIGH_RISK
→ toolsExecuted: [getTransactionDetails, getCustomerProfile, analyzeTransactionVelocity]
→ IBM Granite identificou: transação CNP + rajada de velocidade
```

**Owner:** Dev A

---

## Sub-Task 6 — Ferramentas Analíticas (P1)

**Depende de:** Sub-Task 3 completa (`DataService` funcional com dados reais).

### Ferramentas

#### `analyzeTransactionVelocity`

- Retorna contagens e valores em janelas de tempo configuráveis
- **Primeiro verificar** se `docs/data-contract.md` indica colunas pré-calculadas (ex.: `cardid_count_1m`) — usar se existirem; calcular dinamicamente só se necessário
- Usar apenas dados pré-autorização
- Arquivo: `apps/api/src/tools/analyze-transaction-velocity.tool.ts`

#### `analyzeSpendingPattern`

- Compara o valor da transação com as estatísticas históricas do cliente (média, desvio padrão, p95)
- **Excluir a transação atual** da janela de histórico para evitar vazamento
- Se dados forem insuficientes para estatísticas → retornar `status: 'unavailable'` com `message` explicando
- Arquivo: `apps/api/src/tools/analyze-spending-pattern.tool.ts`

#### `analyzeTransactionContext`

- Detecta anomalias em: hora do dia, canal de transação, tipo de transação
- Compara com a distribuição histórica do cliente
- Se dados forem insuficientes → retornar `status: 'unavailable'`
- Arquivo: `apps/api/src/tools/analyze-transaction-context.tool.ts`

### Passos

1. Implementar `analyzeTransactionVelocity`
2. Implementar `analyzeSpendingPattern`
3. Implementar `analyzeTransactionContext`
4. Registrar as 3 no `ToolRegistry` com descrições JSON ricas
5. Testes unitários para cada ferramenta cobrindo: caso normal, caso com anomalia detectada, dado insuficiente (`status: 'unavailable'`)

### Saídas

| Arquivo | Ferramenta |
|---|---|
| `apps/api/src/tools/analyze-transaction-velocity.tool.ts` | `analyzeTransactionVelocity` |
| `apps/api/src/tools/analyze-spending-pattern.tool.ts` | `analyzeSpendingPattern` |
| `apps/api/src/tools/analyze-transaction-context.tool.ts` | `analyzeTransactionContext` |
| Testes unitários para cada ferramenta | — |

**Owner:** Dev A

---

## Sub-Task 7 — Ferramentas Restantes (parcial)

**Depende de:** Sub-Task 6 completa.  
**Compartilhada com Dev B** (Dev B entrega `getRiskPolicy` e ajustes de policy).

### Ferramentas (parte do Dev A)

#### `checkMerchantHistory`

- Estatísticas agregadas do estabelecimento (ex.: volume de transações, taxa de contestações)
- Usa `DataService`
- Arquivo: `apps/api/src/tools/check-merchant-history.tool.ts`

#### `checkCustomerRiskEvents`

- Eventos de risco anteriores no histórico do cliente (ex.: contestações, bloqueios)
- Usa `DataService`
- Arquivo: `apps/api/src/tools/check-customer-risk-events.tool.ts`

#### `checkGeographicConsistency` *(condicional)*

- **Implementar somente se** `docs/data-contract.md` confirmar que colunas geográficas existem com densidade adequada
- Se os dados não forem adequados → retornar `status: 'unavailable'` com mensagem explicativa (não registrar como erro)
- Arquivo: `apps/api/src/tools/check-geographic-consistency.tool.ts`

### Passos

1. Implementar `checkMerchantHistory`
2. Implementar `checkCustomerRiskEvents`
3. Implementar ou fazer stub de `checkGeographicConsistency` conforme decisão do `data-contract.md`
4. Registrar as ferramentas no `ToolRegistry`
5. Testes unitários para cada ferramenta
6. Executar uma investigação **end-to-end** com todas as 9 ferramentas registradas para validar o sistema completo

### Saídas

| Arquivo | Ferramenta |
|---|---|
| `apps/api/src/tools/check-merchant-history.tool.ts` | `checkMerchantHistory` |
| `apps/api/src/tools/check-customer-risk-events.tool.ts` | `checkCustomerRiskEvents` |
| `apps/api/src/tools/check-geographic-consistency.tool.ts` | `checkGeographicConsistency` |
| Testes unitários para cada ferramenta | — |

**Owner:** Dev A (merchant, risk events, geography) + Dev B (getRiskPolicy, policy gate)

---

## Resumo de todos os entregáveis

| # | Entregável | Sub-Task | Depende de |
|---|---|---|---|
| 1 | `docs/data-contract.md` | 2 | — |
| 2 | Migrations TypeORM | 3 | 1 |
| 3 | `scripts/import-csv.mjs` | 3 | 1 |
| 4 | `DataService` | 3 | 2, 3 |
| 5 | Ferramenta `getTransactionDetails` | 3 | 4 |
| 6 | Ferramenta `getCustomerProfile` | 3 | 4 |
| 7 | Ferramenta `analyzeTransactionVelocity` | 6 | 4 |
| 8 | Ferramenta `analyzeSpendingPattern` | 6 | 4 |
| 9 | Ferramenta `analyzeTransactionContext` | 6 | 4 |
| 10 | Ferramenta `checkMerchantHistory` | 7 | 4 |
| 11 | Ferramenta `checkCustomerRiskEvents` | 7 | 4 |
| 12 | Ferramenta `checkGeographicConsistency` (condicional) | 7 | 1, 4 |
| 13 | Testes unitários para todos os itens acima | 3, 6, 7 | cada entregável |

---

## Regras de segurança (não negociáveis)

- `feedback_label` **NUNCA** aparece em nenhum `ToolResult`, query de banco ou resposta de API
- Campos pós-autorização devem ser excluídos de todas as queries via allowlist explícita
- O `DataService` nunca carrega o CSV na inicialização da aplicação
- Schema do banco muda apenas por migrations explícitas — `synchronize: false` no TypeORM
- Cada ferramenta retorna o envelope `ToolResult<T>` — nunca lança exceção para o `ToolRegistry`

## Contrato de interface com os demais devs

- **Dev C** registra as ferramentas de Dev A no `ToolRegistry` durante os mocks; ao entregar ferramentas reais, Dev A substitui os mocks registrando as implementações reais em `agent.module.ts`
- **Dev B** consome `DataService` indiretamente via ferramentas — não acessa o banco diretamente
- Todos os tipos compartilhados (`ToolResult<T>`, `InvestigationReport`, etc.) estão em `packages/contracts/src/index.ts` — não duplicar
