# Sub-Task 6 — Analytical Tools: Implementation Plan

**Owner:** Dev A  
**Depends on:** Sub-Task 3 (DataService ✅), Sub-Task 2 (data-contract.md ✅)  
**Blocks:** Sub-Task 9 (Evaluation Harness — results only reflect realistic tool patterns once these tools are live)  
**Status:** [x] done — 2026-11-08

---

## Overview

Sub-Task 6 delivers three analytical tools that provide the core fraud signals:

| Tool | Priority | Input | Data source |
|---|---|---|---|
| `analyzeTransactionVelocity` | P1 | `transactionId` | Pre-computed columns + dynamic queries |
| `analyzeSpendingPattern` | P1 | `transactionId`, `customerId` | Aggregate query over history |
| `analyzeTransactionContext` | P1 | `transactionId`, `customerId` | Temporal query over history |

All three follow the exact same implementation pattern as the P0 tools already
delivered in Sub-Task 3 (`get-transaction-details.tool.ts`,
`get-customer-profile.tool.ts`). Read those files before starting.

---

## File map — what to create

```
apps/api/src/
  data/
    data.service.ts                          ← ADD 3 new methods (do not touch existing)
  tools/
    analyze-transaction-velocity.tool.ts     ← NEW
    analyze-transaction-velocity.tool.spec.ts ← NEW
    analyze-spending-pattern.tool.ts         ← NEW
    analyze-spending-pattern.tool.spec.ts    ← NEW
    analyze-transaction-context.tool.ts      ← NEW
    analyze-transaction-context.tool.spec.ts ← NEW
    tools.module.ts                          ← UPDATE (add 3 providers)
packages/contracts/src/
  index.ts                                   ← UPDATE (add 3 data interfaces)
```

---

## Step 1 — Add interfaces to `packages/contracts/src/index.ts`

Add the three typed data shapes below the existing `CustomerProfile` interface.
Follow the same style: `export interface`, all nullable fields, JSDoc comment.

```typescript
/** Data returned by the `analyzeTransactionVelocity` tool. */
export interface VelocityAnalysis {
  /** Pre-computed from column cardid_count_1m — number of card uses in last 1 min */
  countLast1m: number | null;
  /** Pre-computed from column cp_card_prev_term_dist_1h — distance from previous terminal (km) */
  distPrevTerminal1h: number | null;
  /** Pre-computed from column cp_card_term_vel_1h — velocity between terminals (km/h) */
  velocityTerminal1h: number | null;
  /** Dynamic: count of transactions for this card in the last 1 hour */
  countLast1h: number;
  /** Dynamic: count of transactions for this card in the last 24 hours */
  countLast24h: number;
  /** Dynamic: total amount spent on this card in the last 1 hour */
  totalAmountLast1h: number;
}

/** Data returned by the `analyzeSpendingPattern` tool. */
export interface SpendingPattern {
  /** Average transaction amount from customer history */
  avgAmount: number | null;
  /** Standard deviation of transaction amounts */
  stddevAmount: number | null;
  /** 95th percentile of transaction amounts */
  p95Amount: number | null;
  /** Number of historical transactions used in the calculation */
  historicalTransactionCount: number;
  /** ISO-8601 timestamp of the most recent historical transaction */
  lastTransactionAt: string | null;
  /** Current transaction amount (for comparison) */
  currentAmount: number | null;
  /** How many std deviations the current amount is from the mean (null if stddev=0 or no history) */
  zScore: number | null;
}

/** Data returned by the `analyzeTransactionContext` tool. */
export interface TransactionContext {
  /** Hour of day the transaction occurred (0–23) */
  hourOfDay: number;
  /** Day of week (0=Sunday, 6=Saturday) */
  dayOfWeek: number;
  /** Whether the transaction occurred on a weekend */
  isWeekend: boolean;
  /** Transaction channel from the current transaction */
  channel: string | null;
  /** Transaction type from the current transaction (debito | credito) */
  transactionType: string | null;
  /** Transaction modality from the current transaction */
  modality: string | null;
  /** Whether physical card was present */
  cardPresent: boolean | null;
  /**
   * Customer's historical channel distribution.
   * Keys are channel names, values are transaction counts.
   * Excludes the current transaction.
   */
  historicalChannelDistribution: Record<string, number>;
  /**
   * Customer's historical hour-of-day distribution.
   * Keys are hour strings ("0"–"23"), values are transaction counts.
   */
  historicalHourDistribution: Record<string, number>;
  /** Total historical transactions used for distribution (excludes current) */
  historicalTransactionCount: number;
  /** True if the current channel has never been seen in the customer's history */
  isUnknownChannel: boolean;
  /** True if the current hour bin (±2h) has never been seen in the customer's history */
  isUnusualHour: boolean;
}
```

---

## Step 2 — Add 3 methods to `DataService`

File: [`apps/api/src/data/data.service.ts`](../apps/api/src/data/data.service.ts)

**Rule:** Do not modify `getTransactionById` or `getLatestCustomerSnapshot`. Add
new methods below them. Each method must never throw — return `null` or empty
structures on failure.

### 2.1 `getCardVelocity`

```typescript
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
```

### 2.2 `getCustomerSpendingStats`

```typescript
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
```

### 2.3 `getCustomerContextStats`

```typescript
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
```

---

## Step 3 — Implement the three tool files

Each tool follows the exact same structure as `get-transaction-details.tool.ts`:
`@Injectable()`, `implements OnModuleInit`, constructor injects `DataService` +
`ToolRegistry`, `onModuleInit()` calls `this.registry.register(...)`.

### 3.1 `analyze-transaction-velocity.tool.ts`

**File:** `apps/api/src/tools/analyze-transaction-velocity.tool.ts`

**Tool name registered:** `analyzeTransactionVelocity`

**Parameters accepted by the model:**
```json
{
  "transactionId": "string — event_external_id of the transaction to analyze",
  "cardId":        "string — card_id from getTransactionDetails",
  "timestamp":     "string — ISO-8601 timestamp from getTransactionDetails"
}
```
All three are required. The model already has `transactionId`, `cardId`, and
`timestamp` from the `getTransactionDetails` response — it should pass them here.

**Logic:**
1. Validate all three args; return `status: 'error'` if any is missing.
2. Parse `timestamp` arg to `Date`; return `status: 'error'` if invalid ISO-8601.
3. Call `this.dataService.getCardVelocity(cardId, transactionId, ts)`.
4. Parse pre-computed VARCHAR fields to `number | null` (they may be `null` or
   non-numeric strings — guard with `parseFloat` + `isNaN` check).
5. Return `ToolResult<VelocityAnalysis>` with `status: 'success'`.
   - List `cardidCount1m`, `cpCardPrevTermDist1h`, `cpCardTermVel1h` in
     `missingFields` if they were null.
6. On DB exception, return `status: 'unavailable'`.

**Tool description for the model (use verbatim):**
```
Analisa a velocidade de uso do cartão: lê campos pré-calculados da transação
(contagem no último minuto, distância e velocidade entre terminais na última hora)
e computa dinamicamente a contagem e o valor total de transações nas últimas 1h e
24h. Alta velocidade ou muitas transações em janelas curtas são indicadores fortes
de fraude. Requer transactionId, cardId e timestamp de getTransactionDetails.
```

### 3.2 `analyze-spending-pattern.tool.ts`

**File:** `apps/api/src/tools/analyze-spending-pattern.tool.ts`

**Tool name registered:** `analyzeSpendingPattern`

**Parameters accepted by the model:**
```json
{
  "transactionId": "string — event_external_id of the transaction",
  "customerId":    "string — customer_id from getTransactionDetails",
  "currentAmount": "number — amount from getTransactionDetails",
  "timestamp":     "string — ISO-8601 timestamp from getTransactionDetails"
}
```

**Logic:**
1. Validate all args; return `status: 'error'` on missing/invalid.
2. Parse `timestamp` to `Date`.
3. Call `this.dataService.getCustomerSpendingStats(customerId, transactionId, ts)`.
4. If `transactionCount === 0`: return `status: 'unavailable'` with
   `message: 'No historical transactions found for this customer'`.
5. Compute `zScore`:
   - If `stddevAmount` is `null` or `0`: `zScore = null`
   - Otherwise: `zScore = (currentAmount - avgAmount) / stddevAmount`
   - Round to 2 decimal places.
6. Return `ToolResult<SpendingPattern>` with `status: 'success'`.

**Tool description for the model (use verbatim):**
```
Compara o valor da transação atual com o padrão histórico de gastos do associado:
média, desvio padrão e percentil 95 calculados sobre transações anteriores.
O campo zScore indica quantos desvios padrão o valor atual está acima da média —
valores acima de 2.0 são atípicos. Requer transactionId, customerId, currentAmount
e timestamp de getTransactionDetails.
```

### 3.3 `analyze-transaction-context.tool.ts`

**File:** `apps/api/src/tools/analyze-transaction-context.tool.ts`

**Tool name registered:** `analyzeTransactionContext`

**Parameters accepted by the model:**
```json
{
  "transactionId":   "string — event_external_id",
  "customerId":      "string — customer_id from getTransactionDetails",
  "timestamp":       "string — ISO-8601 timestamp from getTransactionDetails",
  "channel":         "string | null — segment_channel_type from getTransactionDetails",
  "transactionType": "string | null — type from getTransactionDetails",
  "modality":        "string | null — modality from getTransactionDetails",
  "cardPresent":     "boolean | null — cardPresent from getTransactionDetails"
}
```
`transactionId`, `customerId`, and `timestamp` are required. The rest are
optional (the model may omit them if it didn't call `getTransactionDetails` first,
but should always call that first).

**Logic:**
1. Validate required args.
2. Parse `timestamp` to `Date`; extract `hourOfDay`, `dayOfWeek`, `isWeekend`.
3. Call `this.dataService.getCustomerContextStats(customerId, transactionId)`.
4. Compute `isUnknownChannel`:
   - `true` if `channel` is non-null AND `channelDistribution[channel]` is
     `undefined` or `0` AND `totalCount > 0`.
   - `false` if no history or channel is null.
5. Compute `isUnusualHour` (±2h window):
   - For each of `[hourOfDay - 2, ..., hourOfDay + 2]` (mod 24), check if any
     has `count > 0` in `hourDistribution`.
   - `isUnusualHour = true` if none of those 5 hours have history AND `totalCount > 0`.
6. Return `ToolResult<TransactionContext>` with `status: 'success'`.
   - Even with 0 historical transactions return `success` (not `unavailable`) —
     a new customer with no history is itself meaningful context.

**Tool description for the model (use verbatim):**
```
Analisa o contexto temporal e de canal da transação: hora do dia, dia da semana,
canal (POS/e-commerce/ATM), tipo e presença de cartão. Compara com o histórico do
associado para detectar canais nunca usados antes (isUnknownChannel) e horários
atípicos (isUnusualHour ±2h). Novo associado sem histórico retorna distribuições
vazias — isso por si só é contexto relevante.
```

---

## Step 4 — Register in `ToolsModule`

File: [`apps/api/src/tools/tools.module.ts`](../apps/api/src/tools/tools.module.ts)

Add the three new providers. No changes to `AgentModule` needed.

```typescript
import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';
import { DataModule } from '../data/data.module.js';
import { GetCustomerProfileTool } from './get-customer-profile.tool.js';
import { GetTransactionDetailsTool } from './get-transaction-details.tool.js';
import { AnalyzeTransactionVelocityTool } from './analyze-transaction-velocity.tool.js';
import { AnalyzeSpendingPatternTool } from './analyze-spending-pattern.tool.js';
import { AnalyzeTransactionContextTool } from './analyze-transaction-context.tool.js';

@Module({
  imports: [DataModule, AgentModule],
  providers: [
    GetTransactionDetailsTool,
    GetCustomerProfileTool,
    AnalyzeTransactionVelocityTool,
    AnalyzeSpendingPatternTool,
    AnalyzeTransactionContextTool,
  ],
})
export class ToolsModule {}
```

---

## Step 5 — Unit tests

Each tool spec follows the exact same pattern as
[`get-transaction-details.tool.spec.ts`](../apps/api/src/tools/get-transaction-details.tool.spec.ts).

### Pattern to follow

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DataService } from '../data/data.service.js';
import { ToolRegistry } from '../agent/tool.registry.js';
import { AnalyzeTransactionVelocityTool } from './analyze-transaction-velocity.tool.js';

function setup() {
  const mockDataService = {
    getCardVelocity: vi.fn(),
    // add only the method(s) this tool calls
  } satisfies Partial<DataService>;

  const registry = new ToolRegistry();
  const tool = new AnalyzeTransactionVelocityTool(
    mockDataService as unknown as DataService,
    registry,
  );
  tool.onModuleInit();

  const execute = (args: Record<string, unknown>) =>
    registry.execute('analyzeTransactionVelocity', args);

  return { mockDataService, execute };
}
```

### Required test cases per tool

#### `analyze-transaction-velocity.tool.spec.ts`

| Test | Scenario |
|---|---|
| `returns success with all velocity fields` | Happy path — all pre-computed fields populated, dynamic counts > 0 |
| `returns success with null precomputed fields in missingFields` | Pre-computed columns are null — listed in missingFields, dynamic counts still returned |
| `returns error when transactionId is missing` | `{}` as args |
| `returns error when cardId is missing` | only transactionId provided |
| `returns error when timestamp is not valid ISO-8601` | `timestamp: 'not-a-date'` |
| `returns unavailable when database throws` | `getCardVelocity` rejects |
| `parses varchar precomputed fields to numbers` | values `'5'`, `'12.3'`, `'87.6'` parsed correctly |

#### `analyze-spending-pattern.tool.spec.ts`

| Test | Scenario |
|---|---|
| `returns success with computed zScore` | History exists, stddev > 0 — zScore computed |
| `returns success with null zScore when stddev is zero` | All historical amounts identical |
| `returns success with null zScore when no history` | `transactionCount = 0` → `status: unavailable` |
| `returns unavailable when customer has no history` | count = 0 |
| `returns error when required args are missing` | `{}` as args |
| `returns unavailable when database throws` | `getCustomerSpendingStats` rejects |
| `zScore is rounded to 2 decimal places` | Verify floating point precision |

#### `analyze-transaction-context.tool.spec.ts`

| Test | Scenario |
|---|---|
| `returns success with isUnknownChannel true for new channel` | Channel not in distribution |
| `returns success with isUnknownChannel false for known channel` | Channel present in distribution |
| `returns success with isUnusualHour true for off-hours transaction` | Hour bin absent from history |
| `returns success with isUnusualHour false for normal-hours transaction` | Hour within ±2h of known activity |
| `returns success with empty distributions for new customer` | totalCount = 0 — status is still success |
| `returns error when required args are missing` | `{}` as args |
| `returns unavailable when database throws` | `getCustomerContextStats` rejects |
| `correctly computes hourOfDay, dayOfWeek, isWeekend` | Saturday 03:00 UTC |

---

## Step 6 — Validation checklist

```
[x] pnpm --filter @fraud-intelligence/api build   — clean, zero TypeScript errors (2026-11-08)
[x] pnpm --filter @fraud-intelligence/api test    — 122/122 tests pass across 12 files (2026-11-08)
[ ] docker compose up -d db + start:dev + smoke test with EVT_SYN_000000001
    → verify toolsExecuted includes analyzeTransactionVelocity, analyzeSpendingPattern,
      analyzeTransactionContext (requires live IBM token)
[ ] No mention of feedback_label in any log or ToolResult
[x] ToolRegistry.size === 5 (5 providers registered in ToolsModule)
```

---

## Key rules (must not violate)

- `feedback_label` never appears in any query, result, or log — the entity already
  structurally prevents this.
- Only pre-authorization fields used: `cardidCount1m`, `cpCardPrevTermDist1h`,
  `cpCardTermVel1h`, `amount`, `event_occurred_at`, `segment_channel_type`,
  `tipo_transacao`, `modalidade_transacao`, `card_presence_flag`.
- Tool implementations must **never throw** — catch all DB exceptions and return
  `status: 'unavailable'`.
- Do not add new TypeORM entities or migrations — all needed columns are in the
  existing `transactions` table (migration `1746000000000-CreateTransactions.ts`).
- `synchronize: false` — no schema changes here.

---

## References

| File | Purpose |
|---|---|
| [`docs/data-contract.md §5.3–5.5`](data-contract.md) | Exact columns and query specs |
| [`apps/api/src/data/transaction.entity.ts`](../apps/api/src/data/transaction.entity.ts) | Entity property names |
| [`apps/api/src/data/data.service.ts`](../apps/api/src/data/data.service.ts) | Where to add new methods |
| [`apps/api/src/tools/get-transaction-details.tool.ts`](../apps/api/src/tools/get-transaction-details.tool.ts) | Reference implementation pattern |
| [`apps/api/src/tools/get-transaction-details.tool.spec.ts`](../apps/api/src/tools/get-transaction-details.tool.spec.ts) | Reference test pattern |
| [`apps/api/src/tools/tools.module.ts`](../apps/api/src/tools/tools.module.ts) | Where to register new providers |
| [`packages/contracts/src/index.ts`](../packages/contracts/src/index.ts) | Where to add data interfaces |
| [`apps/api/src/agent/tool.registry.ts`](../apps/api/src/agent/tool.registry.ts) | ToolRegistry API |
