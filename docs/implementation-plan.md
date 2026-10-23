# FraudLens — Implementation Plan

**Project:** Sicredi Fraud Intelligence — Hello Moto team
**Status:** ACTIVE
**Last updated:** 2026-10-22

---

## Context

This document is the authoritative implementation plan. It supersedes
`fraud-intelligence-architecture-plan.md`, which remains as the original
architecture record.

### Current project state

| Item | Status |
|---|---|
| IBM environment confirmed | ✅ VALIDATED |
| Granite 4 H Small — tool calling working | ✅ VALIDATED |
| ReAct loop with 2 mock tools (PoC) | ✅ VALIDATED |
| watsonx Orchestrate | ❌ Trial expired — unavailable |
| NestJS scaffold | ⏳ PENDING — Sub-Task 1 |
| PostgreSQL / TypeORM / Docker Compose | ⏳ PENDING — Sub-Task 1 |
| DataService / real tools | ⏳ PENDING — Sub-Tasks 2–3 |
| React frontend | ⏳ PENDING — Sub-Task 8 |

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
- **PoC reference:** `test-tool-calling.mjs` at root (to be moved to `docs/poc/`
  in Sub-Task 1).

### What the PoC validated

The `test-tool-calling.mjs` script successfully demonstrated:
1. Authentication via IAM bearer token.
2. Sending tool definitions in the request (`tools` array).
3. The model returned structured `tool_calls` for `getCustomerProfile`.
4. The backend executed the local function and returned the result with `role: "tool"`.
5. The model requested `analyzeTransactionVelocity` in the next round.
6. The backend executed the second tool.
7. The model produced a final text report in Portuguese based on the evidence.

**PoC limitations (not yet resolved):**
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
│   ├── fraud-intelligence-architecture-plan.md  ← original architecture record
│   ├── implementation-plan.md       ← this file (authoritative)
│   ├── backlog.md
│   └── poc/
│       └── test-tool-calling.mjs    ← moved from root in Sub-Task 1
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

```
src/
├── main.ts
├── app.module.ts
├── health/
│   ├── health.controller.ts
│   └── health.module.ts
├── investigation/
│   ├── investigation.module.ts
│   ├── investigation.controller.ts   ← POST /investigations
│   ├── investigation.service.ts      ← use case orchestration
│   └── dto/
│       ├── create-investigation.dto.ts
│       └── investigation-report.dto.ts
├── agent/
│   ├── agent.module.ts
│   ├── watsonx.client.ts             ← HTTP calls to IBM Chat API
│   ├── agent.orchestrator.ts         ← ReAct loop
│   └── tool.registry.ts              ← tool catalog + whitelist + dispatch
├── policy/
│   ├── policy.module.ts
│   └── policy.service.ts             ← deterministic safety rules
├── data/
│   ├── data.module.ts
│   └── data.service.ts               ← CSV/DB access layer (strategy TBD in Sub-Task 2)
└── tools/
    ├── tools.module.ts
    ├── get-transaction-details.tool.ts
    ├── get-customer-profile.tool.ts
    ├── analyze-spending-pattern.tool.ts
    ├── analyze-transaction-context.tool.ts
    ├── analyze-transaction-velocity.tool.ts
    ├── check-merchant-history.tool.ts
    ├── check-geographic-consistency.tool.ts
    ├── check-customer-risk-events.tool.ts
    ├── get-risk-policy.tool.ts
    └── request-member-verification.tool.ts
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
| `DataService` | CSV loading, indexing by ID, query methods — never exposes `feedback_label` | Dev A |
| Tool implementations | One file per tool — query `DataService`, return `ToolResult<T>` envelope | Dev A + Dev B |

---

## Shared Contracts (`packages/contracts/src/index.ts`)

```typescript
// Investigation request
export interface InvestigationRequest {
  transactionId: string;
  customerId: string;
  amount: number;
  timestamp: string;        // ISO-8601
  metadata?: Record<string, unknown>;
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
```

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
- `pnpm --filter api start:dev` runs the NestJS app.
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
10. Update root `README.md` with prerequisites and `pnpm install && pnpm --filter api start:dev`.
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

**Intent:** Implement the `DataService` that loads and indexes the CSV, then
implement `getTransactionDetails` and `getCustomerProfile` as the two foundational
tools that all other analyses depend on. Use only pre-authorization columns.

**Status:** [ ] pending

**Expected Outcomes:**
- `DataService` loads the CSV at app startup using the strategy decided in Sub-Task 2.
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

**Status:** [ ] pending

**Expected Outcomes:**
- `WatsonxClient` calls the IBM Chat API with the correct auth headers, model_id,
  and request body. It does not contain business logic.
- `AgentOrchestrator` implements the same loop as `test-tool-calling.mjs`:
  build messages → call Granite → process tool_calls → dispatch to `ToolRegistry`
  → push tool results → repeat until no tool_calls or max rounds reached.
- Max rounds is configurable via environment variable (default: 8).
- `parseArguments` double-parse logic from the PoC is preserved.
- Unknown tool names are rejected with an error result (whitelist enforced by `ToolRegistry`).
- `AgentOrchestrator` returns the final text content from the model.
- Integration test: call `AgentOrchestrator` with the mock transaction TX-1001 / CUS-001
  (using the two mock tools from the PoC) and verify a non-empty text report is returned.

**Todo:**
1. Implement `WatsonxClient` as a NestJS injectable service with `ConfigService` for credentials.
2. Implement `AgentOrchestrator` — port the loop from `test-tool-calling.mjs` to TypeScript.
3. Preserve `temperature: 0`, `tool_choice_option: "auto"`, `max_tokens: 1200` as defaults.
4. Preserve the `parseArguments` double-parse logic (quirk of Granite's output).
5. Implement the tool dispatch loop using `ToolRegistry.execute(name, args)`.
6. Add round-limit guard — stop after `MAX_INVESTIGATION_ROUNDS` (default 8, env-configurable).
7. Write a system prompt module — a typed constant, not a string hardcoded in the orchestrator.
8. Write an integration test that uses the two mock tools from the PoC and verifies end-to-end loop.

**Relevant Context:**
- The PoC loop is in `docs/poc/test-tool-calling.mjs` — read it before implementing.
- API URL: `https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2024-10-08`
- Model: `ibm/granite-4-h-small`
- The `content` field in system and tool messages is an array: `[{type: "text", text: "..."}]`.
- Credentials: `IBM_PROJECT_ID` and `IBM_ACCESS_TOKEN` env vars.

**Owner:** Dev C

---

### Sub-Task 5 — PolicyService and InvestigationService

**Intent:** Implement the safety layer (PolicyService) that validates the agent's
output and gates interventions, and the InvestigationService that wires together
the orchestrator with the policy layer as a single use-case entry point.

**Status:** [ ] pending

**Expected Outcomes:**
- `PolicyService` validates the `InvestigationReport` via Zod and returns either
  a validated report or a list of validation errors.
- `PolicyService` has a method `canRequestMemberVerification(report)` that returns
  a boolean based on deterministic rules (e.g., riskLevel must be HIGH_RISK or
  SUSPICIOUS to allow the action).
- `InvestigationService` calls `AgentOrchestrator`, parses the output as JSON,
  passes it through `PolicyService`, and returns the validated report.
- If the agent returns malformed JSON, `InvestigationService` returns a safe fallback
  report with `riskLevel: INCONCLUSIVE` and `requiresHumanReview: true`.
- `InvestigationController` wires `POST /investigations` to `InvestigationService`.
- End-to-end test: POST a transaction, receive a validated `InvestigationReport`.

**Todo:**
1. Define the Zod schema for `InvestigationReport` in `apps/api`.
2. Implement `PolicyService.validate(report)` — returns parsed report or throws.
3. Implement `PolicyService.canRequestMemberVerification(report)` — deterministic rule.
4. Implement `InvestigationService.investigate(request)` — full use case flow.
5. Implement `InvestigationController` with `POST /investigations` and input validation DTO.
6. Add global NestJS exception filter for consistent error responses.
7. Write unit tests for `PolicyService` covering valid reports, invalid schemas, and gating rules.
8. Write integration test: POST → AgentOrchestrator → PolicyService → validated report.

**Relevant Context:**
- `InvestigationReport` type lives in `packages/contracts`.
- The Zod schema in `apps/api` must mirror that type — consider zod-to-ts or manual alignment.
- The agent's JSON report must be embedded in the model's final text response.
  The system prompt (Sub-Task 4) must instruct the model to output ONLY valid JSON
  when concluding an investigation — document this in the system prompt module.

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
`requestMemberVerification` is also finalized here with the full PolicyService gate.

**Status:** [ ] pending

**Expected Outcomes:**
- `checkMerchantHistory` returns merchant-level aggregate statistics.
- `checkCustomerRiskEvents` returns prior risk events from the customer's history.
- `getRiskPolicy` returns the static policy config (no DB needed).
- `requestMemberVerification` is registered in `ToolRegistry` but its execution is
  gated: `ToolRegistry.execute('requestMemberVerification', args)` calls
  `PolicyService.canRequestMemberVerification()` before proceeding.
- `checkGeographicConsistency` is implemented only if geographic columns are
  confirmed usable in `docs/data-contract.md`; otherwise it is stubbed to return
  `status: 'unavailable'`.
- All tools registered in `ToolRegistry` with JSON definitions.

**Todo:**
1. Implement `checkMerchantHistory` using `DataService`.
2. Implement `checkCustomerRiskEvents` using `DataService`.
3. Implement `getRiskPolicy` as a static config-driven response.
4. Implement `requestMemberVerification` with PolicyService gate inside `ToolRegistry`.
5. Implement or stub `checkGeographicConsistency` based on data findings.
6. Write unit tests for each.
7. Run a full end-to-end investigation with all 10 tools registered.

**Owner:** Dev A (merchant, risk events, geography) + Dev B (policy, verification)

---

### Sub-Task 8 — React Frontend Scaffold and Investigation UI

**Intent:** Build the minimal web interface: submit a transaction ID, display the
investigation report and tool trace. No advanced UI until core flow works.

**Status:** [ ] pending

**Expected Outcomes:**
- `pnpm --filter web dev` starts the Vite dev server.
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
| `docs/adr/` | Architecture Decision Records with rationale |
| `docs/poc/test-tool-calling.mjs` | Validated PoC — reference for AgentOrchestrator implementation |
| `docs/fraud-intelligence-architecture-plan.md` | Original architecture record (historical) |
