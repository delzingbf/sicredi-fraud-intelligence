# AGENTS.md — FraudLens / Sicredi Fraud Intelligence

Instructions for AI coding assistants (IBM Bob, GitHub Copilot, etc.) working in
this repository. Read this file before making any changes.

---

## Project identity

- **Team:** Hello Moto
- **Program:** IBM AI Experiential Learning Lab 2026 — Sicredi track
- **Goal:** MVP of an agentic fraud investigation system for card transactions
- **Language:** TypeScript throughout (backend, frontend, shared contracts)

---

## Repository layout

```
apps/api/        NestJS backend — fraud investigation API
apps/web/        React + Vite frontend
packages/contracts/  Shared TypeScript types (api and web)
data/            Synthetic Sicredi dataset — NOT committed to git
docs/            All documentation (see below)
scripts/         Utility scripts (data import, evaluation harness)
```

Key files:
- `docs/implementation-plan.md` — **authoritative plan** — read before implementing
- `docs/IBM_WATSONX_SETUP.md` — IBM credentials and token generation
- `docs/poc/test-tool-calling.mjs` — validated PoC loop (reference for `AgentOrchestrator`)
- `docs/adr/` — Architecture Decision Records
- `docs/backlog.md` — GitHub issue proposals

---

## Confirmed technology decisions

| Concern | Decision |
|---|---|
| Backend | NestJS + TypeScript |
| Frontend | React + Vite + TypeScript |
| Shared types | `packages/contracts` — `@fraud-intelligence/contracts` |
| Package manager | pnpm workspaces |
| Database | PostgreSQL + TypeORM, `synchronize: false`, explicit migrations |
| Local DB | Docker Compose |
| Agent validation | Zod |
| AI model | `ibm/granite-4-h-small` via watsonx.ai Chat API |
| Agent architecture | Single investigator agent, ReAct loop in `AgentOrchestrator` |
| Orchestration | No watsonx Orchestrate (trial expired) — programmatic loop in NestJS |

Do not introduce alternatives to these decisions without a new ADR and team review.

---

## NestJS module structure (`apps/api/src/`)

```
health/           GET /health — liveness check
investigation/    POST /investigations — main entry point
  controller      HTTP layer, input validation DTO
  service         Use case — calls orchestrator, applies policy
  dto/            Input/output DTOs
agent/
  watsonx.client  HTTP calls to IBM Chat API — no business logic
  agent.orchestrator  ReAct loop (port of docs/poc/test-tool-calling.mjs)
  tool.registry   Tool catalog, whitelist, dispatch
policy/
  policy.service  Zod validation of reports, requestMemberVerification gating
data/
  data.service    Database access — never exposes feedback_label
tools/            One file per tool implementation (10 tools total)
```

---

## Service ownership

| Service | Owner |
|---|---|
| `InvestigationController` + `InvestigationService` | Dev B |
| `PolicyService` + Zod schemas | Dev B |
| `WatsonxClient` + `AgentOrchestrator` + `ToolRegistry` | Dev C |
| `DataService` + tool implementations | Dev A |
| React frontend | Dev D |

Do not move responsibilities between owners without team coordination.

---

## Tool catalog (10 tools)

1. `getTransactionDetails` — P0, foundational
2. `getCustomerProfile` — P0, foundational
3. `analyzeSpendingPattern` — P1
4. `analyzeTransactionContext` — P1
5. `analyzeTransactionVelocity` — P1 (validated in PoC)
6. `checkMerchantHistory` — P2
7. `checkCustomerRiskEvents` — P2
8. `getRiskPolicy` — static config response
9. `checkGeographicConsistency` — implement only if geographic data is confirmed usable
10. `requestMemberVerification` — gated by `PolicyService`; never a free LLM call

Every tool returns a `ToolResult<T>` envelope:
```typescript
{ status, data, metadata: { tool, dataSource, missingFields }, message? }
```

---

## Report contract

The agent's final output must be a JSON object matching `InvestigationReport`
from `packages/contracts`. Validated by Zod in `PolicyService`.

```typescript
{
  schemaVersion: '1.0',
  transactionId: string,
  riskLevel: 'LOW_RISK' | 'SUSPICIOUS' | 'HIGH_RISK' | 'INCONCLUSIVE',
  recommendedAction: 'PROCEED' | 'REQUEST_MEMBER_VERIFICATION' | 'MANUAL_REVIEW',
  toolsExecuted: string[],
  evidenceFor: string[],
  evidenceAgainst: string[],
  missingInformation: string[],
  contradictions: string[],
  explanation: string,
  requiresHumanReview: boolean,
  confidence: 'LOW' | 'MEDIUM' | 'HIGH'
}
```

---

## IBM watsonx.ai integration

- **Endpoint:** `https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2024-10-08`
- **Model:** `ibm/granite-4-h-small`
- **Auth:** `Authorization: Bearer $IBM_ACCESS_TOKEN` (IAM bearer token, ~1h TTL)
- **Project ID:** `e696fb51-b4b0-4e13-8478-c66e8e9002ed` (non-secret, safe to reference)
- **Credentials from env:** `IBM_PROJECT_ID`, `IBM_ACCESS_TOKEN` — never hardcode

Critical implementation details from the validated PoC:
- `parseArguments`: double JSON.parse — Granite may serialize arguments as a JSON string
- `content` in system/tool messages is an array: `[{ type: "text", text: "..." }]`
- Parameters: `temperature: 0`, `tool_choice_option: "auto"`, `max_tokens: 1200`

For credential setup, see `docs/IBM_WATSONX_SETUP.md`.

---

## Security rules — never violate these

- `feedback_label` is **never** included in any tool response or database query result
- Tool names are validated against a whitelist in `ToolRegistry` before execution
- The agent cannot call `requestMemberVerification` without `PolicyService` approval
- The final report is validated by Zod before any downstream action
- Max investigation rounds enforced by `AgentOrchestrator` code, not the model
- `synchronize: false` in TypeORM — schema changes only via explicit migration files
- No secrets, tokens, or API keys in any committed file

---

## What does NOT exist yet (as of 2026-10-22)

- NestJS application code (`apps/api/` has only `.gitkeep`)
- React application code (`apps/web/` has only `.gitkeep`)
- `package.json` at root (no pnpm workspace configured yet)
- `packages/contracts/`
- Docker Compose file
- TypeORM migrations
- Any real tool implementations

The first implementation task is **Sub-Task 1** in `docs/implementation-plan.md`.

---

## How to run (once Sub-Task 1 is complete)

```bash
# Install all workspace dependencies
pnpm install

# Start the local database
docker compose up -d db

# Start the NestJS backend in dev mode
pnpm --filter api start:dev

# Start the React frontend in dev mode
pnpm --filter web dev

# Health check
curl http://localhost:3001/health
```

---

## Data files

Files in `data/` are excluded from git (`.gitignore` rule: `/data/*`).
They exist only on each developer's local machine.

| File | Contents |
|---|---|
| `data/case_transacoes_cartoes_sintetico_900k.csv` | 900k synthetic transactions, 297 columns |
| `data/dicionario_dados_case_prevencao_sicredi.xlsx` | Data dictionary |
| `data/Orientacoes_case_prevencao_sicredi.txt` | Challenge orientation notes |

The column `feedback_label` (TRUE/FALSE) is the fraud ground-truth label.
It must never be sent to the agent or appear in any tool response.
It is used only in the offline evaluation harness (`scripts/evaluate.mjs`).
