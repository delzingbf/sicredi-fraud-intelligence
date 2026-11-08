# Sub-Task 7 — Plano de Implementação Detalhado

**Dono:** Dev A (`checkMerchantHistory`, `checkCustomerRiskEvents`, `checkGeographicConsistency`) + Dev B (`getRiskPolicy`)  
**Status atual:** `[ ] pending`  
**Pré-requisito:** Sub-Task 6 concluída ✅ — 5 ferramentas ativas, 122 testes passando  
**Gerado em:** 2026-11-08

---

## Visão geral

Sub-Task 7 completa o catálogo de ferramentas: de 5 para 9 ferramentas registradas no
`ToolRegistry`. Três são DB-backed (Dev A), uma é estática (Dev B) e uma é stub (Dev A).

| Ferramenta | Dono | Tipo | DataService? |
|---|---|---|---|
| `checkMerchantHistory` | Dev A | DB query | Novo método |
| `checkCustomerRiskEvents` | Dev A | DB query | Novo método |
| `checkGeographicConsistency` | Dev A | Stub | Não |
| `getRiskPolicy` | Dev B | Estático | Não |

---

## Arquivos a criar / modificar

### Criar (Dev A)
```
packages/contracts/src/index.ts                          ← adicionar 2 interfaces
apps/api/src/data/data.service.ts                        ← adicionar 2 métodos
apps/api/src/tools/check-merchant-history.tool.ts        ← novo
apps/api/src/tools/check-merchant-history.tool.spec.ts   ← novo
apps/api/src/tools/check-customer-risk-events.tool.ts    ← novo
apps/api/src/tools/check-customer-risk-events.tool.spec.ts ← novo
apps/api/src/tools/check-geographic-consistency.tool.ts  ← novo
apps/api/src/tools/check-geographic-consistency.tool.spec.ts ← novo
```

### Modificar (Dev A)
```
apps/api/src/tools/tools.module.ts  ← adicionar 3 novos providers
```

### Criar (Dev B)
```
apps/api/src/tools/get-risk-policy.tool.ts       ← novo
apps/api/src/tools/get-risk-policy.tool.spec.ts  ← novo
```

---

## Passo 1 — Adicionar tipos em `packages/contracts/src/index.ts`

Adicionar ao final do arquivo (após `TransactionContext`), **antes** da seção
`Member Verification`:

```typescript
/** Data returned by the `checkMerchantHistory` tool. */
export interface MerchantHistory {
  /** acceptor_id used as lookup key */
  merchantId: string;
  /** Total number of transactions processed by this merchant in the dataset */
  totalTransactions: number;
  /** Average transaction amount across all merchant transactions */
  avgAmount: number | null;
  /** Maximum transaction amount */
  maxAmount: number | null;
  /** Minimum transaction amount */
  minAmount: number | null;
  /** Static risk score assigned to the merchant (from target transaction row) */
  acceptorRisk: number | null;
  /** Numeric risk flag assigned to the merchant (from target transaction row) */
  acceptorRiskyFlag: number | null;
  /** Mastercard-specific risk score (from target transaction row) */
  acceptorMastercardRisk: number | null;
  /** Visa-specific risk score (from target transaction row) */
  acceptorVisaRisk: number | null;
}

/** Data returned by the `checkCustomerRiskEvents` tool. */
export interface CustomerRiskEvents {
  /** Categorical risk rating from the current transaction snapshot */
  riskRating: string | null;
  /** Whether malware was detected on the device at transaction time */
  malwareFlag: boolean | null;
  /** Count of non-approved transactions by this customer in the last 30 days */
  declinedLast30d: number;
  /** Count of non-approved transactions by this customer in the last 7 days */
  declinedLast7d: number;
}
```

---

## Passo 2 — Adicionar métodos em `DataService`

Adicionar os dois métodos ao final de `apps/api/src/data/data.service.ts`,
**após** `getCustomerContextStats`.

### 2.1 `getMerchantHistory()`

```typescript
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
```

> **Por que duas queries separadas?**  
> Os campos `acceptor_risk`, `acceptor_risky_flag`, etc. são valores snapshot
> da linha da transação alvo — não fazem sentido como agregados (AVG/MAX de um
> risk score multiplicaria ruído). Buscá-los com `findOne` é mais explícito e
> testável independentemente.

---

### 2.2 `getCustomerRiskEvents()`

```typescript
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
```

> **Nota sobre `transaction_status`:** O dataset sintético usa `'approved'` como
> valor padrão. Transações recusadas terão outro valor (ex: `'declined'`,
> `'rejected'`). A cláusula `IS NOT NULL AND != 'approved'` captura todos esses
> casos sem depender de conhecer os valores exatos.

---

## Passo 3 — Criar `check-merchant-history.tool.ts`

**Arquivo:** `apps/api/src/tools/check-merchant-history.tool.ts`

```typescript
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult, MerchantHistory } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';
import { DataService } from '../data/data.service.js';

/**
 * CheckMerchantHistoryTool — returns aggregate statistics and risk scores
 * for a given merchant (acceptor_id).
 *
 * Risk scores (acceptorRisk, acceptorRiskyFlag, etc.) are snapshot values
 * from the target transaction row, not computed aggregates.
 */
@Injectable()
export class CheckMerchantHistoryTool implements OnModuleInit {
  constructor(
    private readonly dataService: DataService,
    private readonly registry: ToolRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('checkMerchantHistory', {
      definition: {
        type: 'function',
        function: {
          name: 'checkMerchantHistory',
          description:
            'Retorna o histórico agregado do estabelecimento: total de transações, ' +
            'valor médio/máximo/mínimo e scores de risco (acceptorRisk, acceptorRiskyFlag, ' +
            'acceptorMastercardRisk, acceptorVisaRisk). Scores de risco elevados ou flag ' +
            'numérico alto indicam estabelecimento conhecido por atividade suspeita. ' +
            'Requer merchantId e transactionId de getTransactionDetails.',
          parameters: {
            type: 'object',
            properties: {
              merchantId: {
                type: 'string',
                description: 'acceptor_id from getTransactionDetails',
              },
              transactionId: {
                type: 'string',
                description: 'event_external_id of the current transaction',
              },
            },
            required: ['merchantId', 'transactionId'],
          },
        },
      },
      implementation: (args) => this.execute(args),
    });
  }

  private async execute(
    args: Record<string, unknown>,
  ): Promise<ToolResult<MerchantHistory>> {
    const merchantId = args['merchantId'];
    const transactionId = args['transactionId'];

    if (typeof merchantId !== 'string' || !merchantId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'checkMerchantHistory', dataSource: 'postgresql', missingFields: ['merchantId'] },
        message: 'merchantId is required',
      };
    }
    if (typeof transactionId !== 'string' || !transactionId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'checkMerchantHistory', dataSource: 'postgresql', missingFields: ['transactionId'] },
        message: 'transactionId is required',
      };
    }

    let history: Awaited<ReturnType<DataService['getMerchantHistory']>>;
    try {
      history = await this.dataService.getMerchantHistory(merchantId, transactionId);
    } catch {
      return {
        status: 'unavailable',
        data: null,
        metadata: { tool: 'checkMerchantHistory', dataSource: 'postgresql', missingFields: [] },
        message: 'Database unavailable',
      };
    }

    return {
      status: 'success',
      data: {
        merchantId,
        totalTransactions: history.totalTransactions,
        avgAmount: history.avgAmount,
        maxAmount: history.maxAmount,
        minAmount: history.minAmount,
        acceptorRisk: history.acceptorRisk,
        acceptorRiskyFlag: history.acceptorRiskyFlag,
        acceptorMastercardRisk: history.acceptorMastercardRisk,
        acceptorVisaRisk: history.acceptorVisaRisk,
      },
      metadata: {
        tool: 'checkMerchantHistory',
        dataSource: 'postgresql',
        missingFields: [],
      },
    };
  }
}
```

---

## Passo 4 — Criar `check-customer-risk-events.tool.ts`

**Arquivo:** `apps/api/src/tools/check-customer-risk-events.tool.ts`

```typescript
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult, CustomerRiskEvents } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';
import { DataService } from '../data/data.service.js';

/**
 * CheckCustomerRiskEventsTool — returns the customer's risk signals:
 * categorical risk rating, malware flag, and decline counts in the last
 * 7 and 30 days.
 */
@Injectable()
export class CheckCustomerRiskEventsTool implements OnModuleInit {
  constructor(
    private readonly dataService: DataService,
    private readonly registry: ToolRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('checkCustomerRiskEvents', {
      definition: {
        type: 'function',
        function: {
          name: 'checkCustomerRiskEvents',
          description:
            'Retorna os sinais de risco do associado: classificação de risco (baixo/medio/alto), ' +
            'flag de malware detectado no dispositivo e contagem de transações recusadas nos ' +
            'últimos 7 e 30 dias. Alta contagem de recusas recentes indica cartão comprometido ' +
            'ou tentativas repetidas de fraude. Requer customerId e transactionId de getTransactionDetails.',
          parameters: {
            type: 'object',
            properties: {
              customerId: {
                type: 'string',
                description: 'customer_id from getTransactionDetails',
              },
              transactionId: {
                type: 'string',
                description: 'event_external_id of the current transaction',
              },
            },
            required: ['customerId', 'transactionId'],
          },
        },
      },
      implementation: (args) => this.execute(args),
    });
  }

  private async execute(
    args: Record<string, unknown>,
  ): Promise<ToolResult<CustomerRiskEvents>> {
    const customerId = args['customerId'];
    const transactionId = args['transactionId'];

    if (typeof customerId !== 'string' || !customerId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'checkCustomerRiskEvents', dataSource: 'postgresql', missingFields: ['customerId'] },
        message: 'customerId is required',
      };
    }
    if (typeof transactionId !== 'string' || !transactionId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'checkCustomerRiskEvents', dataSource: 'postgresql', missingFields: ['transactionId'] },
        message: 'transactionId is required',
      };
    }

    let events: Awaited<ReturnType<DataService['getCustomerRiskEvents']>>;
    try {
      events = await this.dataService.getCustomerRiskEvents(customerId, transactionId);
    } catch {
      return {
        status: 'unavailable',
        data: null,
        metadata: { tool: 'checkCustomerRiskEvents', dataSource: 'postgresql', missingFields: [] },
        message: 'Database unavailable',
      };
    }

    return {
      status: 'success',
      data: {
        riskRating: events.riskRating,
        malwareFlag: events.malwareFlag,
        declinedLast30d: events.declinedLast30d,
        declinedLast7d: events.declinedLast7d,
      },
      metadata: {
        tool: 'checkCustomerRiskEvents',
        dataSource: 'postgresql',
        missingFields: [],
      },
    };
  }
}
```

---

## Passo 5 — Criar `check-geographic-consistency.tool.ts` (stub)

**Arquivo:** `apps/api/src/tools/check-geographic-consistency.tool.ts`

```typescript
import { Injectable, type OnModuleInit } from '@nestjs/common';
import type { ToolResult } from '@fraud-intelligence/contracts';
import { ToolRegistry } from '../agent/tool.registry.js';

/**
 * CheckGeographicConsistencyTool — STUB.
 *
 * Geographic data fill rate is ~23.9% in the dataset (threshold: 30%).
 * Decision documented in docs/data-contract.md section 2.2 and AGENTS.md.
 *
 * The tool is registered so the agent is aware of its existence, but always
 * returns status:'unavailable'. The agent should list it in missingInformation.
 */
@Injectable()
export class CheckGeographicConsistencyTool implements OnModuleInit {
  constructor(private readonly registry: ToolRegistry) {}

  onModuleInit() {
    this.registry.register('checkGeographicConsistency', {
      definition: {
        type: 'function',
        function: {
          name: 'checkGeographicConsistency',
          description:
            'Verifica consistência geográfica entre o endereço do estabelecimento, ' +
            'o terminal e o IP do dispositivo. ATENÇÃO: dados geográficos têm preenchimento ' +
            '~24% no dataset — esta ferramenta retorna unavailable na maioria dos casos.',
          parameters: {
            type: 'object',
            properties: {
              transactionId: {
                type: 'string',
                description: 'event_external_id of the transaction',
              },
            },
            required: ['transactionId'],
          },
        },
      },
      implementation: (_args) => this.execute(),
    });
  }

  private execute(): ToolResult {
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
  }
}
```

> **Nota:** O stub não precisa de `DataService` — remove o import e a dependência
> do construtor para manter o código mínimo.

---

## Passo 6 — Atualizar `tools.module.ts`

Adicionar os 3 novos providers a `apps/api/src/tools/tools.module.ts`:

```typescript
// Novos imports:
import { CheckMerchantHistoryTool } from './check-merchant-history.tool.js';
import { CheckCustomerRiskEventsTool } from './check-customer-risk-events.tool.js';
import { CheckGeographicConsistencyTool } from './check-geographic-consistency.tool.js';

// Adicionar no array providers:
providers: [
  GetTransactionDetailsTool,
  GetCustomerProfileTool,
  AnalyzeTransactionVelocityTool,
  AnalyzeSpendingPatternTool,
  AnalyzeTransactionContextTool,
  CheckMerchantHistoryTool,          // ← novo
  CheckCustomerRiskEventsTool,       // ← novo
  CheckGeographicConsistencyTool,    // ← novo
],
```

> Quando Dev B entregar `GetRiskPolicyTool`, ele adiciona o provider aqui também.

---

## Passo 7 — Testes unitários

### 7.1 `check-merchant-history.tool.spec.ts`

Casos obrigatórios:

| # | Cenário | Expected |
|---|---|---|
| 1 | merchantId ausente | `status: 'error'`, `missingFields: ['merchantId']` |
| 2 | transactionId ausente | `status: 'error'`, `missingFields: ['transactionId']` |
| 3 | DB retorna dados completos | `status: 'success'`, todos os campos preenchidos |
| 4 | DB retorna amounts nulos (merchant sem histórico de amount) | `status: 'success'`, amounts `null` |
| 5 | DB lança exceção | `status: 'unavailable'`, `message: 'Database unavailable'` |
| 6 | merchantId no payload da response deve igualar o arg de entrada | `result.data.merchantId === merchantId` |

Padrão de setup (copiar de `analyze-spending-pattern.tool.spec.ts`):
```typescript
function setup() {
  const mockDataService = {
    getMerchantHistory: vi.fn(),
  } satisfies Partial<DataService>;
  const registry = new ToolRegistry();
  const tool = new CheckMerchantHistoryTool(
    mockDataService as unknown as DataService,
    registry,
  );
  tool.onModuleInit();
  const execute = (args: Record<string, unknown>) =>
    registry.execute('checkMerchantHistory', args);
  return { mockDataService, execute };
}
```

### 7.2 `check-customer-risk-events.tool.spec.ts`

Casos obrigatórios:

| # | Cenário | Expected |
|---|---|---|
| 1 | customerId ausente | `status: 'error'`, `missingFields: ['customerId']` |
| 2 | transactionId ausente | `status: 'error'`, `missingFields: ['transactionId']` |
| 3 | cliente alto risco com malware + declines | `status: 'success'`, campos corretos |
| 4 | cliente sem declines | `status: 'success'`, `declinedLast30d: 0`, `declinedLast7d: 0` |
| 5 | riskRating e malwareFlag nulos | `status: 'success'`, ambos `null` |
| 6 | DB lança exceção | `status: 'unavailable'` |

### 7.3 `check-geographic-consistency.tool.spec.ts`

Casos obrigatórios:

| # | Cenário | Expected |
|---|---|---|
| 1 | qualquer args válido | `status: 'unavailable'` |
| 2 | `message` deve mencionar fill rate | `.message` contém `'~24%'` |
| 3 | `metadata.dataSource` deve ser `'stub'` | `.metadata.dataSource === 'stub'` |
| 4 | `missingFields` deve conter os dois campos geo | contém `'acceptor_latitude'` e `'terminal_latitude'` |

Setup para stub (sem DataService):
```typescript
function setup() {
  const registry = new ToolRegistry();
  const tool = new CheckGeographicConsistencyTool(registry);
  tool.onModuleInit();
  const execute = (args: Record<string, unknown>) =>
    registry.execute('checkGeographicConsistency', args);
  return { execute };
}
```

---

## Passo 8 — Validação final

Executar na ordem:

```bash
# 1. TypeScript — zero erros
pnpm --filter @fraud-intelligence/api build

# 2. Testes — todos passando (espera-se ~140+ após esta sub-task)
pnpm --filter @fraud-intelligence/api test

# 3. Verificar que ToolRegistry tem 8 tools (5 + 3 novos Dev A; +1 quando Dev B entregar)
#    Confirmar no log de startup: "Registered tool: checkMerchantHistory" etc.

# 4. End-to-end (API rodando com IBM credentials)
Invoke-RestMethod -Method POST -Uri "http://localhost:3001/investigations" `
  -ContentType "application/json" `
  -Body '{"transactionId": "EVT_SYN_000000001"}'
# Inspecionar toolsExecuted — deve conter as novas ferramentas
```

---

## Dependência com Dev B

Dev B entrega `getRiskPolicy` nesta mesma sub-task. A ferramenta é independente
(sem DataService), então não bloqueia o trabalho de Dev A. Quando Dev B terminar:

1. Adicionar `GetRiskPolicyTool` no array `providers` de `tools.module.ts`
2. `ToolRegistry.size` passa de 8 para 9
3. Reexecutar build + test + e2e para confirmar que nada quebrou

---

## Critério de conclusão da Sub-Task 7

- [ ] `checkMerchantHistory` implementado, registrado e com testes passando
- [ ] `checkCustomerRiskEvents` implementado, registrado e com testes passando
- [ ] `checkGeographicConsistency` (stub) implementado, registrado e com testes passando
- [ ] `getRiskPolicy` implementado, registrado e com testes passando *(Dev B)*
- [ ] `pnpm --filter @fraud-intelligence/api build` — zero erros TypeScript
- [ ] `pnpm --filter @fraud-intelligence/api test` — todos os testes passando
- [ ] `ToolRegistry.size === 9` após startup com as 4 novas ferramentas
- [ ] Investigação e2e com `EVT_SYN_000000001` retorna `toolsExecuted` com as novas ferramentas
- [ ] `MerchantHistory` e `CustomerRiskEvents` exportados em `@fraud-intelligence/contracts`
- [ ] Marcar Sub-Task 7 como `[x] done` em `docs/implementation-plan.md`
