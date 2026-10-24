# FraudLens — Implementation Plan

**Project:** Sicredi Fraud Intelligence — Hello Moto team
**Status:** ACTIVE
**Last updated:** 2026-10-24

---

## Context

This document is the authoritative implementation plan. It supersedes the
original architecture record (`docs/fraud-intelligence-architecture-plan.md`).

### Current project state

| Item | Status |
|---|---|
| IBM environment confirmed | ✅ VALIDATED |
| Granite 4 H Small — tool calling working | ✅ VALIDATED |
| ReAct loop with 2 mock tools (PoC) | ✅ VALIDATED |
| watsonx Orchestrate | ❌ Trial expired — unavailable |
| NestJS scaffold + monorepo + health check | ✅ DONE — Sub-Task 1 |
| `packages/contracts` shared types | ✅ DONE — Sub-Task 1 |
| `PolicyService` + Zod schema validation | ✅ DONE — Sub-Task 5 |
| `InvestigationService` + fallback `INCONCLUSIVE` | ✅ DONE — Sub-Task 5 |
| `POST /investigations` controller + DTO | ✅ DONE — Sub-Task 5 |
| `IAgentOrchestrator` interface + `AgentError` | ✅ DONE — Sub-Task 5 |
| Global exception filter | ✅ DONE — Sub-Task 5 |
| PostgreSQL Docker Compose + db scripts | ✅ IMPLEMENTED — runtime not rechecked in this audit |
| TypeORM integration + migrations | ⏳ PENDING — database implementation |
| DataService / CSV import / migrations | ⏳ PENDING — Sub-Tasks 2–3 |
| `WatsonxClient` + `ToolRegistry` + `AgentOrchestrator` | ✅ IMPLEMENTED — real IBM with three mock tools |
| Analytical tools (velocity, spending, context) | ⏳ PENDING — Sub-Task 6 |
| Remaining data tools | ⏳ PENDING — Sub-Task 7 |
| Simulated member verification + policy gate | ✅ IMPLEMENTED — post-investigation endpoints |
| React/Vite scaffold | ✅ IMPLEMENTED — investigation UI pending (Sub-Task 8) |
| Evaluation harness | ⏳ PENDING — Sub-Task 9 |

### Confirmed decisions

- **IBM environment:** watsonx.ai Studio + Runtime, region `us-south`, project
  `watsonx Hackathon Sandbox` (`e696fb51-b4b0-4e13-8478-c66e8e9002ed`).
- **Model:** `ibm/granite-4-h-small` — only model confirmed available in the lab.
- **IBM integration path:** Direct Chat API with programmatic ReAct loop in NestJS
  (`AgentOrchestrator`). No Orchestrate.
- **Stack:** NestJS + TypeScript, React + Vite + TypeScript, pnpm workspaces.
- **Database:** PostgreSQL with TypeORM, `synchronize: false`, explicit migrations.
  Local database via Docker Compose.
- **Agent contract validation:** Zod.
- **Shared types:** `packages/contracts/` — importable by both `api` and `web`.
- **PoC reference:** `docs/poc/test-tool-calling.mjs`.

### What the PoC validated

The `test-tool-calling.mjs` script successfully demonstrated:
1. Authentication via IAM bearer token.
2. Sending tool definitions in the request (`tools` array).
3. The model returned structured `tool_calls` for `getCustomerProfile`.
4. The backend executed the local function and returned the result with `role: "tool"`.
5. The model requested `analyzeTransactionVelocity` in the next round.
6. The backend executed the second tool.
7. The model produced a final text report in Portuguese based on the evidence.

**Original PoC limitations (historical; the NestJS implementation now validates JSON):**
- Tools use fixed simulated data — no integration with the real Sicredi CSV.
- Final report is free text — no JSON schema validation.
- No audit trail persistence.
- No NestJS integration.

### Non-goals for this MVP

- Multi-agent architecture.
- Real financial operations or card blocking.
- Batch processing of all 900k transactions.
- Fine-tuning any model.
- Deploying to production infrastructure.

---

## Repository Structure (target)

```
sicredi-fraud-intelligence/
├── apps/
│   ├── api/              ← NestJS backend
│   └── web/              ← React + Vite frontend
├── data/
│   ├── .gitkeep
│   ├── Orientacoes_case_prevencao_sicredi.txt
│   ├── case_transacoes_cartoes_sintetico_900k.csv
│   └── dicionario_dados_case_prevencao_sicredi.xlsx
├── docs/
│   ├── IBM_WATSONX_SETUP.md
│   ├── adr/
│   │   ├── ADR-001-single-agent.md
│   │   ├── ADR-002-direct-chat-api.md
│   │   ├── ADR-003-postgresql-typeorm.md
│   │   ├── ADR-004-pnpm-monorepo.md
│   │   └── ADR-005-zod-validation.md
│   ├── fraud-intelligence-architecture-plan.md  ← original architecture record (historical)
│   ├── IBM_WATSONX_SETUP.md
│   ├── implementation-plan.md       ← this file (authoritative)
│   ├── backlog.md
│   └── poc/
│       └── test-tool-calling.mjs
├── packages/
│   └── contracts/        ← shared TypeScript types (api + web)
├── scripts/
│   └── evaluate.mjs      ← evaluation harness (Sub-Task 9)
├── package.json          ← pnpm workspace root
├── pnpm-workspace.yaml
├── .env.example
├── .gitignore
├── AGENTS.md             ← instructions for AI coding assistants
└── README.md
```

---

## NestJS Module Architecture (`apps/api/src/`)

Current layout (2026-10-24 — reflects what is present; `data/` and `tools/` are pending Sub-Tasks 2–3, 6–7):

```
src/
├── main.ts
├── app.module.ts
├── configure-app.ts              ← shared app setup (main.ts + e2e tests)
├── health/
│   ├── health.controller.ts
│   ├── health.controller.spec.ts
│   └── health.module.ts
├── investigation/
│   ├── investigation.module.ts
│   ├── investigation.controller.ts   ← POST /investigations + verification endpoints
│   ├── investigation.service.ts      ← use case orchestration + timeout
│   ├── investigation.service.spec.ts
│   ├── investigation.store.ts        ← in-memory bounded store
│   ├── verification.service.ts       ← simulated member verification
│   └── dto/
│       ├── create-investigation.schema.ts   ← Zod request schema (not class-validator DTO)
│       └── verification.schema.ts
├── agent/
│   ├── agent.module.ts               ← wires real AgentOrchestrator + 3 mock tools
│   ├── agent.orchestrator.interface.ts
│   ├── agent.orchestrator.ts         ← ReAct loop + JSON correction retry
│   ├── agent.orchestrator.spec.ts
│   ├── system-prompt.ts
│   ├── tool.registry.ts              ← tool catalog + whitelist + dispatch
│   ├── tool.registry.spec.ts
│   ├── watsonx.client.ts             ← HTTP calls to IBM Chat API
│   └── watsonx.client.spec.ts
├── policy/
│   ├── policy.module.ts
│   ├── policy.service.ts             ← Zod validation + requestMemberVerification gate
│   ├── policy.service.spec.ts
│   └── investigation-report.schema.ts ← Zod schema for InvestigationReport
├── common/
│   ├── filters/
│   │   └── http-exception.filter.ts
│   └── zod/
│       ├── zod-validation.pipe.ts
│       └── format-zod-issues.ts
├── config/
│   └── app.config.ts                 ← Zod env validation
├── data/                             ← ⏳ PENDING (Sub-Tasks 2–3)
│   ├── data.module.ts
│   └── data.service.ts
└── tools/                            ← ⏳ PENDING (Sub-Tasks 3, 6–7)
    ├── tools.module.ts
    └── <one file per tool>
```

### Service boundaries

| Service | Responsibility | Owner |
|---|---|---|
| `InvestigationController` | HTTP layer — validates input, returns report | Dev B |
| `InvestigationService` | Use case — calls `AgentOrchestrator`, validates output via `PolicyService` | Dev B |
| `PolicyService` | Zod schema validation, `requestMemberVerification` gating, max iterations config | Dev B |
| `WatsonxClient` | HTTP to IBM Chat API — auth header, endpoint, model_id, no business logic | Dev C |
| `AgentOrchestrator` | ReAct loop — message history, tool call processing, round limit | Dev C |
| `ToolRegistry` | Tool JSON definitions (for LLM), whitelist map, dispatch to implementations | Dev C + Dev A |
| `DataService` | PostgreSQL queries via TypeORM, explicit field selection — never exposes `feedback_label` | Dev A |
| Tool implementations | One file per tool — query `DataService`, return `ToolResult<T>` envelope | Dev A + Dev B |

---

## Shared Contracts (`packages/contracts/src/index.ts`)

```typescript
// Investigation request — only transactionId comes from the client; the backend
// resolves every other transaction field from DataService.
export interface InvestigationRequest {
  transactionId: string;
}

// Standard tool response envelope
export type ToolStatus = 'success' | 'not_found' | 'unavailable' | 'error';

export interface ToolResult<T = unknown> {
  status: ToolStatus;
  data: T | null;
  metadata: {
    tool: string;
    dataSource: string;
    missingFields: string[];
  };
  message?: string;
}

// Final agent report
export type RiskLevel = 'LOW_RISK' | 'SUSPICIOUS' | 'HIGH_RISK' | 'INCONCLUSIVE';
export type RecommendedAction = 'PROCEED' | 'REQUEST_MEMBER_VERIFICATION' | 'MANUAL_REVIEW';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';

export interface InvestigationReport {
  schemaVersion: '1.0';
  transactionId: string;
  riskLevel: RiskLevel;
  recommendedAction: RecommendedAction;
  toolsExecuted: string[];
  evidenceFor: string[];
  evidenceAgainst: string[];
  missingInformation: string[];
  contradictions: string[];
  explanation: string;
  requiresHumanReview: boolean;
  confidence: Confidence;
}

// POST /investigations response
export interface InvestigationResult {
  investigationId: string;  // server-generated UUID v4
  report: InvestigationReport;
}

// Simulated member verification
export type VerificationStatus = 'PENDING' | 'CONFIRMED' | 'DENIED';
export type VerificationDecision = Exclude<VerificationStatus, 'PENDING'>;

export interface VerificationRecord {
  investigationId: string;
  transactionId: string;
  status: VerificationStatus;
  requestedAt: string;      // ISO-8601
  resolvedAt?: string;      // ISO-8601
}
```

`packages/contracts` is **types only** — it is consumed from source and every
import is erased at compile time. Do not add runtime values (`const`, `enum`, `class`).

---

## Sub-Tasks

---

### Sub-Task 1 — Monorepo Foundation and NestJS Scaffold

**Intent:** Initialize the monorepo workspace, scaffold the NestJS app, create the
shared contracts package, configure environment variables, and add a health check.
This is the base that all other sub-tasks build on. No AI, no data, no tools.

**Status:** [x] done — 2026-10-22

**Expected Outcomes:**
- `pnpm install` succeeds from the root.
- `pnpm --filter @fraud-intelligence/api start:dev` runs the NestJS app.
- `GET /health` returns `{ status: 'ok' }` with HTTP 200.
- TypeScript compiles with no errors.
- `packages/contracts` is importable from `apps/api`.
- `docs/poc/test-tool-calling.mjs` exists (moved from root).
- `.env.example` documents all required variables without values.
- Root `README.md` updated with setup instructions.

**Todo:**
1. Create `package.json` at root with pnpm workspace config.
2. Create `pnpm-workspace.yaml` listing `apps/*` and `packages/*`.
3. Scaffold `packages/contracts/` with `package.json` and `src/index.ts` containing all shared types.
4. Scaffold `apps/api/` with `nest new` (or manually) with TypeScript strict mode.
5. Add `packages/contracts` as a workspace dependency in `apps/api/package.json`.
6. Create the `HealthModule` and `HealthController` with `GET /health`.
7. Configure `ConfigModule` with validation for `IBM_PROJECT_ID` and `IBM_ACCESS_TOKEN`.
8. Create `.env.example` at root documenting `IBM_PROJECT_ID`, `IBM_ACCESS_TOKEN`, `PORT`.
9. Move `test-tool-calling.mjs` from root to `docs/poc/test-tool-calling.mjs`.
10. Update root `README.md` with prerequisites and `pnpm install && pnpm --filter @fraud-intelligence/api start:dev`.
11. Verify `.gitignore` covers `node_modules/`, `.env`, `dist/`, and the CSV data.

**Relevant Context:**
- `test-tool-calling.mjs` at root — move, do not delete.
- `.gitignore` already covers `/data/*` — no changes needed there.
- `IBM_PROJECT_ID`: `e696fb51-b4b0-4e13-8478-c66e8e9002ed` (non-secret, safe to document).
- Auth pattern from PoC: `Authorization: Bearer ${process.env.IBM_ACCESS_TOKEN}`.
- `apps/api/.gitkeep` and `apps/web/.gitkeep` should be removed once real files exist.

**Owner:** Dev B (NestJS structure) + Dev C (validates contracts package compiles)

---

### Sub-Task 2 — Dataset Inspection and Data Strategy Decision

**Intent:** Before writing a single line of `DataService`, inspect the actual CSV
columns and data dictionary to determine: which fields exist, which are
pre-authorization, what the fraud label column is named, and whether geographic
and velocity fields are usable. The result is a written data contract document —
not code.

**Status:** [ ] pending

**Expected Outcomes:**
- `docs/data-contract.md` created with:
  - Confirmed column names for each tool's required inputs.
  - List of pre-authorization fields (safe to expose to the agent).
  - List of post-authorization fields (must be excluded from all tool responses).
  - Exact name of the fraud label column (confirmed as `feedback_label` from the
    orientation file, but verify in the actual CSV header).
  - Assessment of geographic fields (lat/lon, city) — are they populated enough?
  - Assessment of velocity-related pre-computed columns vs. computed-at-query-time.
  - PostgreSQL table/index design: which columns need indexes for the tools.
  - Index keys per tool (e.g., transaction_id, customer_id, merchant_id).

**Todo:**
1. Read the CSV header row (first line only — no need to load all 900k rows).
2. Read `data/dicionario_dados_case_prevencao_sicredi.xlsx` using Bob's office_read tool.
3. Read `data/Orientacoes_case_prevencao_sicredi.txt` for context.
4. Identify which columns are needed for each of the 10 planned tools.
5. Identify post-authorization columns that must NEVER appear in tool responses.
6. Confirm `feedback_label` column name and its values (TRUE/FALSE).
7. Assess geographic fields: do latitude/longitude or city columns exist with reasonable fill rates?
8. Assess velocity pre-computed columns (e.g. `cardid_count_1m`) vs. dynamic computation.
9. Design the PostgreSQL schema: which columns map to which tables, which indexes are needed.
10. Write `docs/data-contract.md` documenting all findings.

**Relevant Context:**
- Orientation file mentions `feedback_label` as the target column.
- 297 columns — many may be post-authorization or too sparse to use.
- 900k rows × 297 columns — loading all as JS objects may be ~500MB+; evaluate carefully.
- The PoC used `customer_id` and `transaction_id` as lookup keys — confirm these exist.
- `feedback_label` must never be included in any `ToolResult` response.

**Owner:** Dev A (primary) with all devs reviewing the output doc before proceeding to Sub-Task 3.

---

### Sub-Task 3 — DataService and First Two Tools

**Intent:** Implement the `DataService` that queries PostgreSQL via TypeORM, then
implement `getTransactionDetails` and `getCustomerProfile` as the two foundational
tools that all other analyses depend on. Use only pre-authorization columns.

**Status:** [ ] pending

**Expected Outcomes:**
- A separate import script loads approved CSV fields into PostgreSQL after explicit migrations.
- `DataService` queries TypeORM repositories; it does not load the CSV at app startup.
- `DataService` exposes typed query methods: `getTransaction(id)`, `getCustomer(id)`.
- `feedback_label` is excluded from all returned data — enforced by a field allowlist.
- `getTransactionDetails` returns a `ToolResult<TransactionDetails>` with the standard envelope.
- `getCustomerProfile` returns a `ToolResult<CustomerProfile>`.
- Both tools handle `not_found` and `unavailable` status correctly.
- Unit tests cover: found case, not-found case, missing field reporting.

**Todo:**
1. Implement `DataService` based on the strategy from `docs/data-contract.md`.
2. Apply the pre-authorization field allowlist — never expose `feedback_label`.
3. Implement `get-transaction-details.tool.ts` using `DataService`.
4. Implement `get-customer-profile.tool.ts` using `DataService`.
5. Register both tools in `ToolRegistry` with their JSON definitions (for the LLM) and implementations.
6. Write unit tests for `DataService` and both tools.
7. Verify that the tool JSON definitions include a rich `description` — this is what the LLM reads to decide when to call the tool.

**Relevant Context:**
- See `docs/data-contract.md` for confirmed column names (created in Sub-Task 2).
- `ToolResult<T>` type is in `packages/contracts`.
- Tool JSON definition format mirrors the PoC's `tools` array in `test-tool-calling.mjs`.
- `getCustomerProfile` was already validated in the PoC — use the same tool name and parameter schema.

**Owner:** Dev A

---

### Sub-Task 4 — WatsonxClient and AgentOrchestrator

**Intent:** Implement the NestJS equivalent of `test-tool-calling.mjs` — the
`WatsonxClient` handles HTTP to IBM, and the `AgentOrchestrator` manages the
ReAct loop. This is a direct TypeScript port of the validated PoC logic, not a
redesign.

**Status:** [x] done — 2026-10-23

**Expected Outcomes:**
- `WatsonxClient` calls the IBM Chat API with the correct auth headers, model_id,
  and request body. It does not contain business logic.
- `AgentOrchestrator` implements the same loop as `test-tool-calling.mjs`:
  build messages → call Granite → process tool_calls → dispatch to `ToolRegistry`
  → push tool results → repeat until no tool_calls or max rounds reached.
- Max rounds is configurable via environment variable (default: 8).
- `parseArguments` double-parse logic from the PoC is preserved.
- Unknown tool names are rejected with an error result (whitelist enforced by `ToolRegistry`).
- `AgentOrchestrator` returns `{ finalText, toolsExecuted }` and accepts an `AbortSignal`.
- Automated tests use a mocked IBM client; manual real-IBM execution with TX-1001 / CUST-42 produced a validated report using three mock tools. This is not a fraud-quality evaluation.

**Todo:**
1. Implement `WatsonxClient` as a NestJS injectable service with `ConfigService` for credentials.
2. Implement `AgentOrchestrator` — port the loop from `test-tool-calling.mjs` to TypeScript.
3. Preserve `temperature: 0`, `tool_choice_option: "auto"`, `max_tokens: 1200` as defaults.
4. Preserve the `parseArguments` double-parse logic (quirk of Granite's output).
5. Implement the tool dispatch loop using `ToolRegistry.execute(name, args)`.
6. Add round-limit guard — stop after `MAX_INVESTIGATION_ROUNDS` (default 8, env-configurable).
7. Write a system prompt module — a typed constant, not a string hardcoded in the orchestrator.
8. Test the loop with a mocked IBM client, including JSON correction, round limits and cancellation.

**Relevant Context:**
- The PoC loop is in `docs/poc/test-tool-calling.mjs` — read it before implementing.
- API URL: `https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2024-10-08`
- Model: `ibm/granite-4-h-small`
- The `content` field in system and tool messages is an array: `[{type: "text", text: "..."}]`.
- Credentials: `IBM_PROJECT_ID` and `IBM_ACCESS_TOKEN` env vars.

**Current implementation notes (2026-10-24):**
- `AgentModule` registers `getTransactionDetails`, `getCustomerProfile` and `analyzeTransactionVelocity` with fixed mock data. Real data tools remain pending.
- The orchestrator attempts one JSON syntax correction without tools, within the round budget and timeout. Zod and semantic validation remain in `PolicyService`.
- `ToolRegistry` enforces registered names and parses arguments into objects (including double-encoded JSON). Per-tool schema/type validation is not yet centralized; implementations currently check required identifiers.
- IBM errors, including HTTP 401, currently map to generic `IBM_ERROR`; the API does not specifically identify expired tokens.
- Test files exist for all three agent components. This documentation audit did not rerun tests or real IBM calls.

**Owner:** Dev C

---

### Sub-Task 5 — PolicyService and InvestigationService

**Intent:** Implement the safety layer (PolicyService) that validates the agent's
output and gates interventions, and the InvestigationService that wires together
the orchestrator with the policy layer as a single use-case entry point.

**Status:** [x] done — 2026-10-23

**Implemented files:**

| File | Description |
|---|---|
| `apps/api/src/policy/investigation-report.schema.ts` | Zod schema mirroring `InvestigationReport` + semantic invariants (`superRefine`); bidirectional compile-time type guard |
| `apps/api/src/policy/policy.service.ts` | `validate(raw)` → `ValidationResult` (never throws) + `canRequestMemberVerification(report)` |
| `apps/api/src/policy/policy.module.ts` | NestJS module exporting `PolicyService` |
| `apps/api/src/agent/agent.orchestrator.interface.ts` | `IAgentOrchestrator`, `AgentResult`, `AGENT_ORCHESTRATOR` token, `AgentError` / `AgentErrorCode` |
| `apps/api/src/agent/agent.module.ts` | Provides the real `AgentOrchestrator`, IBM client and three mock data tools |
| `apps/api/src/investigation/investigation.service.ts` | Use case: agent (timeout + `AbortSignal`) → parse → validate → `transactionId` check → authoritative `toolsExecuted` → store; `INCONCLUSIVE` fallback on any failure |
| `apps/api/src/investigation/investigation.store.ts` | In-memory, bounded (1 000) store of reports + verification state, keyed by `investigationId` |
| `apps/api/src/investigation/verification.service.ts` | Simulated member verification: `PENDING` → `CONFIRMED`/`DENIED`, gate evaluated on the stored report |
| `apps/api/src/investigation/investigation.controller.ts` | Investigation + verification endpoints (see below) |
| `apps/api/src/investigation/dto/*.schema.ts` | Zod request schemas (`.strict()`) |
| `apps/api/src/common/zod/` | `ZodValidationPipe` + `formatZodIssues` (shared by controller and `PolicyService`) |
| `apps/api/src/common/filters/http-exception.filter.ts` | Global exception filter: `HttpException` forwarded; unknown errors → 500 without details |
| `apps/api/src/configure-app.ts` | Global app setup shared by `main.ts` and e2e tests |
| `apps/api/test/investigations.e2e-spec.ts` | e2e on the real `AppModule`: wiring, validation, fallbacks, full verification flow and forgery attempts |

**Test results:** 46 unit tests ✅ — 28 e2e tests ✅ (no IBM credentials needed;
`vitest.config.e2e.ts` injects dummy values).

**HTTP API (for Dev D):**

| Method + path | Body | Response |
|---|---|---|
| `POST /investigations` | `{ transactionId }` — 1–100 chars, `[A-Za-z0-9_-]`, no other fields | `200 InvestigationResult` (always 200; failures → `INCONCLUSIVE`) · `400` invalid body |
| `POST /investigations/:id/member-verification` | none | `200 VerificationRecord` (`PENDING`) · `400` id not UUID · `403` policy denies · `404` unknown id · `409` already requested |
| `POST /investigations/:id/member-verification/confirm` | `{ decision }` — `CONFIRMED` or `DENIED` | `200 VerificationRecord` · `400` · `404` not requested · `409` already resolved |
| `GET /investigations/:id/member-verification` | — | `200 VerificationRecord` · `404` |

The verification gate always evaluates the report the backend stored for `:id`.
The client never sends a report, so it cannot forge one.

**Agent integration contract (for Dev C):**

`AgentOrchestrator` must implement `IAgentOrchestrator` from
`apps/api/src/agent/agent.orchestrator.interface.ts`:

```typescript
interface AgentResult {
  finalText: string;        // model's final message (raw JSON report)
  toolsExecuted: string[];  // tools actually dispatched, in order
}

interface IAgentOrchestrator {
  investigate(request: InvestigationRequest, signal: AbortSignal): Promise<AgentResult>;
}
```

- Happy path: resolves with `AgentResult`. `toolsExecuted` is authoritative and
  replaces whatever list the model writes in its report.
- Error path: rejects with `AgentError` using `'IBM_ERROR' | 'ROUND_LIMIT' | 'EMPTY_RESPONSE' | 'TIMEOUT'`.
- `signal` is aborted after `INVESTIGATION_TIMEOUT_MS` (`TIMEOUT` is raised by
  `InvestigationService`). Pass it to every `fetch()` to IBM and stop between
  rounds when `signal.aborted`.
- `request` carries only `transactionId`; fetch the transaction context through
  the tools / `DataService`.

The real implementation is already registered in `AgentModule`:
`{ provide: AGENT_ORCHESTRATOR, useClass: AgentOrchestrator }`.

**`requestMemberVerification` (decision for Dev C / Sub-Task 7):**

It is **not** a tool in `ToolRegistry`. The agent can only *recommend* it via
`recommendedAction: 'REQUEST_MEMBER_VERIFICATION'`; the verification itself is a
post-investigation action through the endpoints above, gated by
`PolicyService.canRequestMemberVerification()` on the stored report.

**Relevant Context:**
- `InvestigationReport` type lives in `packages/contracts`.
- The Zod schema uses `z.literal('1.0')` for `schemaVersion` — the agent must
  output exactly `"schemaVersion": "1.0"` in its final JSON response.
- The system prompt (Sub-Task 4) must instruct the model to output ONLY raw JSON
  as its final message — no prose, no markdown fences.

**Owner:** Dev B

---

### Sub-Task 6 — Analytical Tools (Velocity, Spending, Context)

**Intent:** Implement the three medium-priority analytical tools that provide the
core fraud signals. These depend on `DataService` (Sub-Task 3) being complete.

**Status:** [ ] pending

**Expected Outcomes:**
- `analyzeTransactionVelocity` returns counts and amounts for configurable time windows.
- `analyzeSpendingPattern` compares the transaction amount to the customer's historical
  spending statistics (mean, std dev, p95).
- `analyzeTransactionContext` flags anomalies in hour-of-day, transaction channel,
  and transaction type based on the customer's historical patterns.
- All three tools return `ToolResult<T>` with the standard envelope.
- If data is insufficient for statistics, the tool returns `status: 'unavailable'`
  with a `message` explaining why.
- Unit tests cover normal case, anomaly case, and missing data case.

**Todo:**
1. Implement `analyzeTransactionVelocity` — use only pre-authorization temporal data.
   Check if pre-computed velocity columns exist (from `docs/data-contract.md`) before
   computing dynamically.
2. Implement `analyzeSpendingPattern` — compute per-customer stats from historical
   transactions; exclude the current transaction from the history window.
3. Implement `analyzeTransactionContext` — extract temporal features (hour bin, weekend/weekday)
   and compare against customer's historical distribution.
4. Register all three in `ToolRegistry` with rich descriptions.
5. Write unit tests.

**Relevant Context:**
- `docs/data-contract.md` will specify which velocity columns are pre-computed vs. need computation.
- Do NOT include `feedback_label` or post-authorization columns in any computation.
- `analyzeTransactionVelocity` was already used in the PoC — same tool name, extend to real data.

**Owner:** Dev A

---

### Sub-Task 7 — Remaining Tools and Tool Catalog Completion

**Intent:** Implement `checkMerchantHistory`, `checkCustomerRiskEvents`,
`getRiskPolicy`, and — only if geographic data is adequate — `checkGeographicConsistency`.
(`requestMemberVerification` is already delivered as a post-investigation API action — see Sub-Task 5.)

**Status:** [ ] pending

**Expected Outcomes:**
- `checkMerchantHistory` returns merchant-level aggregate statistics.
- `checkCustomerRiskEvents` returns prior risk events from the customer's history.
- `getRiskPolicy` returns the static policy config (no DB needed).
- `requestMemberVerification` is NOT registered in `ToolRegistry` (see Sub-Task 5).
- `checkGeographicConsistency` is implemented only if geographic columns are
  confirmed usable in `docs/data-contract.md`; otherwise it is stubbed to return
  `status: 'unavailable'`.
- All tools registered in `ToolRegistry` with JSON definitions.

**Todo:**
1. Implement `checkMerchantHistory` using `DataService`.
2. Implement `checkCustomerRiskEvents` using `DataService`.
3. Implement `getRiskPolicy` as a static config-driven response.
4. Implement or stub `checkGeographicConsistency` based on data findings.
5. Write unit tests for each.
6. Run a full end-to-end investigation with all 9 tools registered.

**Owner:** Dev A (merchant, risk events, geography) + Dev B (policy, verification)

---

### Sub-Task 8 — React Frontend Scaffold and Investigation UI

**Intent:** Build the minimal web interface: submit a transaction ID, display the
investigation report and tool trace. No advanced UI until core flow works.

**Status:** [ ] pending

**Expected Outcomes:**
- `pnpm --filter @fraud-intelligence/web start:dev` starts the Vite dev server.
- User can enter a transaction ID and trigger an investigation.
- The investigation report is displayed with all fields clearly readable.
- The tool execution trace (which tools were called, in order) is displayed.
- `requestMemberVerification` shows a confirmation dialog (simulated — no real action).
- `packages/contracts` types are imported directly in the frontend.

**Todo:**
1. Initialize `apps/web/` with Vite + React + TypeScript.
2. Add `packages/contracts` as workspace dependency.
3. Implement `InvestigationForm` component.
4. Implement `InvestigationReport` display component.
5. Implement `ToolTrace` component showing tool calls in order.
6. Implement `MemberVerificationDialog` (simulated confirmation).
7. Wire API calls to `POST /investigations`.
8. Add basic error handling for API failures.

**Owner:** Dev D

---

### Sub-Task 9 — Evaluation Harness

**Intent:** Build a script that runs the agent against a stratified sample of
transactions and computes quality metrics. This is the primary validation of the
system's fraud detection quality.

**Status:** [ ] pending

**Expected Outcomes:**
- Script accepts a sample size N and a random seed for reproducibility.
- Sample is stratified: includes both fraud and legitimate transactions.
- Each transaction is submitted to the running API.
- The `riskLevel` from the report is compared to `feedback_label` from the CSV.
- Metrics computed: Precision, Recall, F1 (per class), AUPRC, confusion matrix.
- Tool selection patterns are logged (which tools were called per investigation).
- Results written to `data/processed/evaluation-YYYY-MM-DD.json`.

**Todo:**
1. Write a Node.js or Python script in `scripts/evaluate.mjs`.
2. Load the CSV and sample N rows with stratification.
3. For each sampled transaction, call `POST /investigations` on the local API.
4. Map `riskLevel` to a binary prediction: `HIGH_RISK` or `SUSPICIOUS` → predicted fraud.
5. Compute precision, recall, F1, and confusion matrix against `feedback_label`.
6. Log tool call patterns.
7. Write results to `data/processed/`.
8. Document how to run: `node scripts/evaluate.mjs --n 200 --seed 42`.

**Owner:** Dev C (architecture) + Dev D (implementation)

---

## System Prompt (reference)

The system prompt module (`apps/api/src/agent/system-prompt.ts`) must instruct Granite:

1. Act as the Hello Moto fraud investigator agent.
2. Use only evidence returned by tools — do not invent data.
3. Never declare confirmed fraud based solely on anomalies.
4. If information is missing or contradictory, return `INCONCLUSIVE`.
5. After gathering sufficient evidence (or reaching the tool limit), respond with
   ONLY a JSON object matching the `InvestigationReport` schema — no prose, no markdown.
6. Confidence is a qualitative self-assessment — do not present it as a statistical probability.

The last instruction is critical: the agent must output raw JSON as its final
message so that `InvestigationService` can parse it directly.

---

## Environment Variables

| Variable | Description | Example |
|---|---|---|
| `IBM_PROJECT_ID` | watsonx.ai project ID | `e696fb51-b4b0-4e13-8478-c66e8e9002ed` |
| `IBM_ACCESS_TOKEN` | IAM bearer token (1h TTL) | *(generated at runtime — never commit)* |
| `PORT` | NestJS listen port | `3001` |
| `MAX_INVESTIGATION_ROUNDS` | Max ReAct loop iterations | `8` |
| `INVESTIGATION_TIMEOUT_MS` | Hard timeout per investigation (aborts the agent) | `30000` |
| `IBM_CHAT_API_URL` | IBM Chat API endpoint | `https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2024-10-08` |
| `IBM_MODEL_ID` | Foundation model ID | `ibm/granite-4-h-small` |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@localhost:5432/fraudlens` |

---

## Security Rules (non-negotiable)

- `feedback_label` is NEVER included in any tool response.
- Tool names are validated against a whitelist before execution.
- Tool arguments are validated before execution.
- The final report is validated via Zod before any action is taken.
- Max rounds limit is enforced by the orchestrator, not the LLM.
- No secrets in committed code or `.env` files.
- Post-authorization columns are excluded from all tool responses.
- Tool results are treated as data — they cannot override system instructions.
- Database migrations run explicitly — `synchronize: false` in TypeORM config.

---

## Related Documents

| Document | Purpose |
|---|---|
| `README.md` | Project entry point — prerequisites and quick start |
| `AGENTS.md` | Instructions for AI coding assistants (Bob, Copilot, etc.) |
| `docs/IBM_WATSONX_SETUP.md` | IBM Cloud auth and token generation guide |
| `docs/backlog.md` | GitHub issue proposals for all sub-tasks |
| `docs/adr/` | Architecture Decision Records (ADR-001–005) with rationale |
| `docs/poc/test-tool-calling.mjs` | Validated PoC — reference for AgentOrchestrator implementation |
| `docs/fraud-intelligence-architecture-plan.md` | Original architecture record (historical) |


## Running the current mock-data investigation (2026-10-24)

The backend calls real IBM Granite; only the three data tools are mocked. A valid
`IBM_PROJECT_ID` and `IBM_ACCESS_TOKEN` must be available to the API process.
`ConfigModule` currently uses its default `.env` lookup relative to the API working
directory (`apps/api` when launched with the workspace filter); root `.env` loading
is not explicitly configured. Exported shell variables are also supported.
Never commit credentials. Token renewal is manual; HTTP 401 currently becomes a
generic IBM API error in the client-facing fallback.

```bash
pnpm dev
```

In a second terminal:

```bash
curl -sS http://localhost:3001/investigations \
  -H 'Content-Type: application/json' \
  -d '{"transactionId":"TX-1001"}' | jq .
```

`jq` is optional and only formats the response. The response is
`{ investigationId, report }`. The mock transaction resolves to `CUST-42`;
`toolsExecuted` lists dispatched tool names. Risk conclusions apply only to the
fixed mock scenario. The frontend is still the Vite starter, not an investigation UI.
PostgreSQL is not used by these mock tools.

Local verification commands (no live IBM call required):

```bash
pnpm run build
pnpm --filter @fraud-intelligence/api run test
pnpm --filter @fraud-intelligence/api run test:e2e
```

These commands are instructions, not a claim that tests passed in this documentation audit.
