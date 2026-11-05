# Sub-Task 3 — Plano Detalhado: DataService e Primeiras Duas Ferramentas

**Owner:** Dev A  
**Status:** pendente → pronto para execução  
**Bloqueante para:** Sub-Tasks 6 e 7  
**Entregável:** `DataService`, migration TypeORM, script de importação CSV, `getTransactionDetails`, `getCustomerProfile`

> **Pré-requisitos confirmados:**
> - Sub-Task 1 ✅ — monorepo NestJS funcional, `ToolRegistry` e `AgentModule` disponíveis  
> - Sub-Task 2 ✅ — `docs/data-contract.md` com schema, índices e mapeamento de colunas confirmados  
> - Sub-Task 4 ✅ — `AgentOrchestrator` e `ToolRegistry.register()` prontos para receber tools reais  
> - `DATABASE_URL=postgresql://fraudlens:fraudlens@localhost:5432/fraudlens` já em `.env.example`

---

## Contexto de arquitetura

O `AgentModule` atualmente registra três mock tools diretamente em `agent.module.ts`
(usando `useFactory`). A instrução do arquivo é **não modificar `agent.module.ts`**
para adicionar tools reais — em vez disso, cada tool usa `OnModuleInit` no seu próprio
provider/módulo para chamar `registry.register()`.

O `DataService` será provido por um `DataModule` separado, importado pelo `AgentModule`
(ou `AppModule`). Isso mantém as responsabilidades isoladas.

---

## Arquivos a criar

```
apps/api/src/data/
  data.module.ts               — NestJS module exportando DataService
  data.service.ts              — queries TypeORM, nunca expõe feedback_label
  transaction.entity.ts        — TypeORM entity mapeando a tabela transactions

apps/api/src/tools/
  get-transaction-details.tool.ts   — implementação + registro no ToolRegistry
  get-customer-profile.tool.ts      — implementação + registro no ToolRegistry

apps/api/src/migrations/
  1746000000000-CreateTransactions.ts  — migration TypeORM (CREATE TABLE + índices)

scripts/
  import-csv.mjs               — importa CSV → PostgreSQL (Node.js, sem NestJS)

apps/api/src/data/
  data.service.spec.ts         — unit tests do DataService
apps/api/src/tools/
  get-transaction-details.tool.spec.ts
  get-customer-profile.tool.spec.ts
```

---

## Tarefa 1 — Instalar dependências TypeORM

TypeORM e o driver `pg` ainda não estão em `apps/api/package.json`.

```bash
pnpm --filter @fraud-intelligence/api add @nestjs/typeorm typeorm pg
pnpm --filter @fraud-intelligence/api add -D @types/pg
```

E adicionar `DATABASE_URL` ao schema Zod em `app.config.ts`, tornando-a **obrigatória**
(atualmente é `optional()`):

```typescript
// apps/api/src/config/app.config.ts — alterar linha existente:
DATABASE_URL: z.string().url().default('postgresql://fraudlens:fraudlens@localhost:5432/fraudlens'),
```

Adicionar `DATABASE_URL` ao tipo `AppEnv` fica automático via `z.infer`.

---

## Tarefa 2 — TypeORM Entity: `Transaction`

**Arquivo:** `apps/api/src/data/transaction.entity.ts`

Mapeia a tabela `transactions` do `data-contract.md`. Regras:
- `@Entity('transactions')` com nome explícito
- Todas as colunas do contrato presentes — sem `feedback_label` nem campos pós-autorização
- Colunas de `customer_*` são campos normais (não há relação com outra entidade)
- Tipos TypeScript devem espelhar os tipos PostgreSQL:

| PostgreSQL | TypeScript |
|---|---|
| `VARCHAR` | `string \| null` |
| `NUMERIC(14,2)` | `number \| null` (TypeORM retorna `string` do pg — usar `transformer`) |
| `TIMESTAMPTZ` | `Date` |
| `BOOLEAN` | `boolean \| null` |

> **Atenção sobre `NUMERIC`:** o driver `pg` retorna `NUMERIC` como `string` por padrão.
> Usar `transformer: { to: (v) => v, from: (v) => v != null ? parseFloat(v) : null }`
> em cada coluna `NUMERIC`, ou configurar `pg.types.setTypeParser` no bootstrap do app.
> A opção mais limpa para este projeto é o transformer inline por coluna.

Colunas obrigatórias no entity (lista completa do `data-contract.md`, seção 3.1):

```typescript
@PrimaryColumn({ name: 'id', type: 'varchar', length: 100 })
id: string;                        // event_external_id

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

@Column({ name: 'amount', type: 'numeric', precision: 14, scale: 2, nullable: true, transformer: numericTransformer })
amount: number | null;

@Column({ name: 'event_occurred_at', type: 'timestamptz' })
eventOccurredAt: Date;

// ... (todas as demais colunas do contrato)
```

Definir `numericTransformer` como constante reutilizável no mesmo arquivo:

```typescript
const numericTransformer = {
  to: (value: number | null) => value,
  from: (value: string | null) => (value != null ? parseFloat(value) : null),
};
```

---

## Tarefa 3 — Migration TypeORM

**Arquivo:** `apps/api/src/migrations/1746000000000-CreateTransactions.ts`

O migration deve conter exatamente o SQL do `data-contract.md` seção 3.1 e 3.2.

```typescript
import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTransactions1746000000000 implements MigrationInterface {
  name = 'CreateTransactions1746000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE transactions ( ... )`);
    await queryRunner.query(`CREATE INDEX idx_transactions_customer_id ON transactions(customer_id)`);
    await queryRunner.query(`CREATE INDEX idx_transactions_customer_time ON transactions(customer_id, event_occurred_at DESC)`);
    await queryRunner.query(`CREATE INDEX idx_transactions_acceptor_id ON transactions(acceptor_id)`);
    await queryRunner.query(`CREATE INDEX idx_transactions_customer_status ON transactions(customer_id, transaction_status)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS transactions`);
  }
}
```

Adicionar script `migration:run` em `apps/api/package.json`:

```json
"migration:run": "typeorm migration:run -d dist/data-source.js",
"migration:revert": "typeorm migration:revert -d dist/data-source.js"
```

E criar `apps/api/src/data-source.ts` — instância standalone de `DataSource` para o CLI do TypeORM:

```typescript
// apps/api/src/data-source.ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Transaction } from './data/transaction.entity.js';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env['DATABASE_URL'] ?? 'postgresql://fraudlens:fraudlens@localhost:5432/fraudlens',
  entities: [Transaction],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
```

---

## Tarefa 4 — DataModule e DataService

### `apps/api/src/data/data.module.ts`

```typescript
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService<AppEnv, true>) => ({
        type: 'postgres',
        url: config.get('DATABASE_URL', { infer: true }),
        entities: [Transaction],
        synchronize: false,
        migrations: [],
        logging: false,
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Transaction]),
  ],
  providers: [DataService],
  exports: [DataService],
})
export class DataModule {}
```

### `apps/api/src/data/data.service.ts`

Responsabilidades:
- Recebe `Repository<Transaction>` via injeção (`@InjectRepository`)
- Expõe **somente** os métodos que as tools precisam
- **Nunca** seleciona `feedback_label` — a coluna não existe no entity, então a proteção é estrutural
- Retorna `null` quando não encontrado (sem lançar exceção)

**Métodos necessários para Sub-Task 3:**

```typescript
/** Retorna a transação por event_external_id. null = não encontrada. */
async getTransactionById(id: string): Promise<Transaction | null>

/** Retorna o snapshot mais recente do cliente (última transação por customer_id). */
async getLatestCustomerSnapshot(customerId: string): Promise<Transaction | null>
```

**Padrão de implementação:**

```typescript
async getTransactionById(id: string): Promise<Transaction | null> {
  return this.repo.findOne({ where: { id } });
}

async getLatestCustomerSnapshot(customerId: string): Promise<Transaction | null> {
  return this.repo.findOne({
    where: { customerId },
    order: { eventOccurredAt: 'DESC' },
  });
}
```

> **Nota sobre Sub-Tasks 6 e 7:** `DataService` receberá mais métodos nessas sub-tasks
> (`getCardVelocity`, `getSpendingStats`, `getMerchantStats`, etc.). Projetar o serviço
> para crescer sem refactor — cada método é independente.

---

## Tarefa 5 — Tool: `getTransactionDetails`

**Arquivo:** `apps/api/src/tools/get-transaction-details.tool.ts`

### Contrato de retorno (`TransactionDetails`)

Definir o tipo em `packages/contracts/src/index.ts`:

```typescript
export interface TransactionDetails {
  transactionId: string;
  customerId: string;
  amount: number | null;
  timestamp: string;           // ISO-8601
  type: string | null;         // debito | credito
  modality: string | null;
  channel: string | null;
  cardPresent: boolean | null;
  merchantId: string | null;
  merchantName: string | null;
  merchantCity: string | null;
  merchantRegion: string | null;
  mcc: string | null;
  cardId: string | null;
}
```

### Implementação

Padrão de implementação com `OnModuleInit` para auto-registro:

```typescript
@Injectable()
export class GetTransactionDetailsTool implements OnModuleInit {
  constructor(
    private readonly dataService: DataService,
    private readonly registry: ToolRegistry,
  ) {}

  onModuleInit() {
    this.registry.register('getTransactionDetails', {
      definition: { /* ver seção de definições JSON abaixo */ },
      implementation: (args) => this.execute(args),
    });
  }

  private async execute(args: Record<string, unknown>): Promise<ToolResult<TransactionDetails>> {
    const transactionId = args['transactionId'];
    if (typeof transactionId !== 'string' || !transactionId) {
      return {
        status: 'error',
        data: null,
        metadata: { tool: 'getTransactionDetails', dataSource: 'postgresql', missingFields: ['transactionId'] },
        message: 'transactionId is required',
      };
    }

    let tx: Transaction | null;
    try {
      tx = await this.dataService.getTransactionById(transactionId);
    } catch {
      return {
        status: 'unavailable',
        data: null,
        metadata: { tool: 'getTransactionDetails', dataSource: 'postgresql', missingFields: [] },
        message: 'Database unavailable',
      };
    }

    if (!tx) {
      return {
        status: 'not_found',
        data: null,
        metadata: { tool: 'getTransactionDetails', dataSource: 'postgresql', missingFields: [] },
        message: `Transaction ${transactionId} not found`,
      };
    }

    const missingFields: string[] = [];
    if (tx.amount == null) missingFields.push('amount');
    if (tx.tipoTransacao == null) missingFields.push('type');
    // ... verificar demais campos opcionais

    return {
      status: 'success',
      data: {
        transactionId: tx.id,
        customerId: tx.customerId,
        amount: tx.amount,
        timestamp: tx.eventOccurredAt.toISOString(),
        type: tx.tipoTransacao,
        modality: tx.modalidadeTransacao,
        channel: tx.segmentChannelType,
        cardPresent: tx.cardPresenceFlag,
        merchantId: tx.acceptorId,
        merchantName: tx.acceptorName,
        merchantCity: tx.acceptorCity,
        merchantRegion: tx.acceptorRegion,
        mcc: tx.mcc,
        cardId: tx.cardId,
      },
      metadata: { tool: 'getTransactionDetails', dataSource: 'postgresql', missingFields },
    };
  }
}
```

### Definição JSON para o modelo (descrição rica)

```typescript
{
  type: 'function',
  function: {
    name: 'getTransactionDetails',
    description:
      'Recupera os dados completos de uma transação a partir do seu ID: valor, ' +
      'horário, tipo (débito/crédito), canal, estabelecimento, MCC, customer_id do ' +
      'titular e flag de cartão presente. Deve ser a PRIMEIRA ferramenta chamada em ' +
      'qualquer investigação — todas as demais ferramentas dependem do customerId ' +
      'retornado aqui.',
    parameters: {
      type: 'object',
      properties: {
        transactionId: {
          type: 'string',
          description: 'ID único da transação (event_external_id).',
        },
      },
      required: ['transactionId'],
    },
  },
}
```

---

## Tarefa 6 — Tool: `getCustomerProfile`

**Arquivo:** `apps/api/src/tools/get-customer-profile.tool.ts`

### Contrato de retorno (`CustomerProfile`)

```typescript
export interface CustomerProfile {
  customerId: string;
  name: string | null;
  segment: string | null;
  riskRating: number | null;
  city: string | null;
  region: string | null;
  registrationDate: string | null;
  totalCreditLimit: number | null;
  totalBalance: number | null;
  presumedIncome: number | null;
  onboardingScore: number | null;
  kycLevel: string | null;
  numberOfCards: string | null;
  emailChangeFlag: boolean | null;
  phoneChangeFlag: boolean | null;
}
```

### Estratégia de query

Conforme `data-contract.md` seção 2.3: dados de cliente variam por transação (snapshot).
O método `DataService.getLatestCustomerSnapshot(customerId)` retorna a linha mais recente.

### Implementação

Mesmo padrão de `OnModuleInit`. Lógica de `execute`:

```typescript
const snapshot = await this.dataService.getLatestCustomerSnapshot(customerId);
if (!snapshot) {
  return { status: 'not_found', ... };
}
return {
  status: 'success',
  data: {
    customerId: snapshot.customerId,
    name: snapshot.customerName,
    segment: snapshot.customerSegment,
    riskRating: snapshot.customerRiskRating,
    city: snapshot.customerCity,
    region: snapshot.customerRegion,
    registrationDate: snapshot.customerRegistrationDate,
    totalCreditLimit: snapshot.customerTotalCreditLimit,
    totalBalance: snapshot.customerTotalBalance,
    presumedIncome: snapshot.customerPresumedIncome,
    onboardingScore: snapshot.customerOnboardingScore,
    kycLevel: snapshot.customerKycLvl,
    numberOfCards: snapshot.customerNumberOfCards,
    emailChangeFlag: snapshot.customerEmailChangeFlag,
    phoneChangeFlag: snapshot.customerPhoneChangeFlag,
  },
  metadata: { tool: 'getCustomerProfile', dataSource: 'postgresql', missingFields },
};
```

### Definição JSON para o modelo

```typescript
{
  type: 'function',
  function: {
    name: 'getCustomerProfile',
    description:
      'Retorna o perfil cadastral mais recente do associado: segmento, rating de risco, ' +
      'limite de crédito, saldo, renda presumida, score de onboarding, KYC e flags de ' +
      'alteração de e-mail/telefone. Usar logo após getTransactionDetails para estabelecer ' +
      'o perfil de risco base do titular antes de analisar padrões comportamentais.',
    parameters: {
      type: 'object',
      properties: {
        customerId: {
          type: 'string',
          description: 'customer_id retornado por getTransactionDetails.',
        },
      },
      required: ['customerId'],
    },
  },
}
```

---

## Tarefa 7 — Registrar tools e integrar ao AppModule

### `ToolsModule`

Criar `apps/api/src/tools/tools.module.ts` agrupando os dois providers:

```typescript
@Module({
  imports: [DataModule, AgentModule],
  providers: [GetTransactionDetailsTool, GetCustomerProfileTool],
})
export class ToolsModule {}
```

> **Importante:** `AgentModule` precisa **exportar** `ToolRegistry` (já exporta desde Sub-Task 4).
> `DataModule` exporta `DataService`.

### Adicionar ao `AppModule`

```typescript
// apps/api/src/app.module.ts
imports: [
  ConfigModule.forRoot({ ... }),
  HealthModule,
  InvestigationModule,
  ToolsModule,   // ← adicionar
]
```

### Remover mock tools sobrepostos

As tools mock de `getTransactionDetails` e `getCustomerProfile` no `agent.module.ts`
serão **sobrescritas** pelo `registry.register()` chamado em `onModuleInit()` de cada tool real,
pois `register()` já aceita re-registro. **Não editar `agent.module.ts`** (instrução do arquivo).
O mock de `analyzeTransactionVelocity` permanece até Sub-Task 6.

---

## Tarefa 8 — Script de importação CSV → PostgreSQL

**Arquivo:** `scripts/import-csv.mjs`

Script Node.js puro (sem NestJS), usando o pacote `pg` diretamente para máxima performance.

### Abordagem: streaming com `COPY`

Para 900.000 linhas, a abordagem correta é usar `COPY FROM STDIN` via `pg-copy-streams`,
evitando carregar todo o CSV em memória.

```bash
pnpm add -D pg-copy-streams @types/pg-copy-streams
```

### Lógica do script

```
1. Ler DATABASE_URL de process.env (ou --db-url arg)
2. Verificar se a tabela transactions existe (migration deve ter rodado)
3. Abrir stream de leitura do CSV (data/case_transacoes_cartoes_sintetico_900k.csv)
4. Parsear header — mapear índices das colunas permitidas
5. Montar COPY com apenas as colunas do data-contract (excluindo feedback_label e pós-autorização)
6. Stream de transformação: linha CSV → linha formatada para COPY
7. Reportar progresso a cada 50.000 linhas
8. Ao final: print de linhas importadas e tempo decorrido
```

### Colunas a incluir no COPY (lista completa do contrato)

```
id, customer_id, card_id, acceptor_id, account_id, terminal_id,
amount, event_occurred_at,
tipo_transacao, modalidade_transacao, segment_channel_type, card_presence_flag, mcc,
acceptor_name, acceptor_city, acceptor_region, acceptor_latitude, acceptor_longitude,
acceptor_risk, acceptor_risky_flag, acceptor_mastercard_risk, acceptor_visa_risk,
terminal_latitude, terminal_longitude, device_ip_latitude, device_ip_longitude,
cardid_count_1m, cp_card_prev_term_dist_1h, cp_card_term_vel_1h,
transaction_status, malware_flag, customer_risk_rating,
customer_name, customer_segment, customer_city, customer_region,
customer_registration_date, customer_total_credit_limit, customer_total_balance,
customer_presumed_income, customer_onboarding_score, customer_kyc_lvl,
customer_number_of_cards, customer_email_change_flag, customer_phone_change_flag
```

**Colunas explicitamente excluídas:**

```
feedback_label, fraud, fraud_score, mc_fraud_score, visa_fraud_score,
action_code, decision, approval_code, fdz_feedbacks, fdz_triggered_actions,
event_treatment_date, dispute_end_date, dispute_feedback_notes, dispute_notes,
dispute_reason, dispute_refunded, dispute_start_date, dispute_submitted_by
```

### Tratamento de valores nulos

O CSV usa `''` (vazio) e possivelmente `None` para valores ausentes. O script deve
normalizar para `\N` (null no formato COPY do PostgreSQL) antes de enviar ao banco.

### Uso

```bash
# Pré-requisito: migration já aplicada
pnpm --filter @fraud-intelligence/api migration:run

# Importar (de uma vez — idempotente com ON CONFLICT DO NOTHING ou TRUNCATE antes)
node scripts/import-csv.mjs

# Com caminho customizado
node scripts/import-csv.mjs --csv data/case_transacoes_cartoes_sintetico_900k.csv
```

---

## Tarefa 9 — Testes unitários

### `data.service.spec.ts`

Testar via mock do `Repository<Transaction>`:

| Caso | Entrada | Resultado esperado |
|---|---|---|
| Transação encontrada | id existente | retorna `Transaction` |
| Transação não encontrada | id inexistente | retorna `null` |
| Snapshot de cliente encontrado | customerId com transações | retorna a mais recente |
| Cliente sem histórico | customerId sem transações | retorna `null` |

### `get-transaction-details.tool.spec.ts`

Mock do `DataService`:

| Caso | Entrada | `ToolResult.status` esperado |
|---|---|---|
| Sucesso | transactionId existente | `'success'` |
| Não encontrada | transactionId inexistente | `'not_found'` |
| transactionId ausente | args `{}` | `'error'` |
| DB indisponível | DataService lança erro | `'unavailable'` |
| Campos opcionais nulos | tx com `amount: null` | `'success'` + `missingFields: ['amount']` |

### `get-customer-profile.tool.spec.ts`

Mesmos cenários adaptados para `getCustomerProfile`.

**Padrão de mock** (consistente com os testes existentes no projeto):

```typescript
import { describe, it, expect, vi } from 'vitest';
import type { DataService } from '../data/data.service.js';

const mockDataService = {
  getTransactionById: vi.fn(),
  getLatestCustomerSnapshot: vi.fn(),
} satisfies Partial<DataService>;
```

---

## Tarefa 10 — Atualizar `.env.example` e documentação

`DATABASE_URL` já está em `.env.example`. Verificar se `app.config.ts` agora a trata
como obrigatória (Tarefa 1 acima). Nenhuma outra variável nova é necessária.

Atualizar `docs/implementation-plan.md` ao concluir:
- Sub-Task 3 status: `[ ] pending` → `[x] done — <data>`

---

## Checklist de execução

```
[ ] Tarefa 1 — Instalar @nestjs/typeorm, typeorm, pg + atualizar DATABASE_URL em app.config.ts
[ ] Tarefa 2 — Criar transaction.entity.ts com todas as colunas do contrato + numericTransformer
[ ] Tarefa 3 — Criar migration CreateTransactions + data-source.ts + scripts migration:run/revert
[ ] Tarefa 4 — Criar DataModule + DataService (getTransactionById, getLatestCustomerSnapshot)
[ ] Tarefa 5 — Criar get-transaction-details.tool.ts com OnModuleInit + tipo TransactionDetails
[ ] Tarefa 6 — Criar get-customer-profile.tool.ts com OnModuleInit + tipo CustomerProfile
[ ] Tarefa 7 — Criar ToolsModule + importar no AppModule (mocks de agent.module.ts são sobrescritos automaticamente)
[ ] Tarefa 8 — Criar scripts/import-csv.mjs com streaming COPY
[ ] Tarefa 9 — Escrever testes unitários (DataService + 2 tools)
[ ] Tarefa 10 — Rodar migration + importar CSV + smoke test manual (curl POST /investigations com EVT_SYN_000000001)
[ ] Atualizar docs/implementation-plan.md com status e decisões de implementação
[ ] Revisão com Dev B (AppModule imports) e Dev C (mock replacement no ToolRegistry)
```

---

## Decisões de design confirmadas

| Decisão | Resultado |
|---|---|
| Tabela `customers` separada | Não — snapshot por transação, query no mais recente |
| Proteção contra `feedback_label` | Estrutural — coluna não existe no entity |
| Registro de tools | `OnModuleInit` em cada tool provider (sem modificar `agent.module.ts`) |
| Mock tools sobrescritos | Sim — `register()` aceita re-registro, mock de `analyzeTransactionVelocity` permanece |
| Transformer de NUMERIC | Inline por coluna (`numericTransformer`) |
| Import do CSV | `COPY FROM STDIN` via streaming (não INSERT por linha) |
| Idempotência do import | `ON CONFLICT (id) DO NOTHING` no COPY ou TRUNCATE antes |
| Testes | vitest + mocks de `Repository<Transaction>` e `DataService` |

---

## Dependências de Sub-Tasks futuras

| Sub-Task | Depende de |
|---|---|
| Sub-Task 6 — Velocity, Spending, Context | `DataService` com métodos adicionais (novos métodos, sem refactor) |
| Sub-Task 7 — Merchant History, Risk Events | `DataService.getMerchantStats`, `DataService.getRiskEvents` |
| Sub-Task 9 — Evaluation Harness | Script de importação + dados reais no banco |
