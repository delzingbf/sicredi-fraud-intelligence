# FraudLens — Sicredi Fraud Intelligence

**Team:** Hello Moto  
**Program:** IBM AI Experiential Learning Lab 2026 — Sicredi track

An agentic fraud investigation system for card transactions. A single AI agent
(IBM Granite 4 H Small) investigates individual transactions by dynamically
selecting tools, gathering evidence, and producing a structured, explainable report.

---

## Quick links

| Document | Purpose |
|---|---|
| [`docs/implementation-plan.md`](docs/implementation-plan.md) | Authoritative implementation plan — read first |
| [`docs/IBM_WATSONX_SETUP.md`](docs/IBM_WATSONX_SETUP.md) | IBM Cloud auth and token generation |
| [`docs/data-contract.md`](docs/data-contract.md) | Database schema, column mapping, excluded fields |
| [`docs/adr/`](docs/adr/) | Architecture Decision Records |
| [`docs/backlog.md`](docs/backlog.md) | GitHub issue proposals |
| [`AGENTS.md`](AGENTS.md) | Context for AI coding assistants |

---

## Stack

| Layer | Technology |
|---|---|
| Backend | NestJS + TypeScript |
| Frontend | React + Vite + TypeScript |
| Shared types | `packages/contracts` (pnpm workspace) |
| Database | PostgreSQL + TypeORM (Docker Compose for local) |
| AI model | IBM Granite 4 H Small — `ibm/granite-4-h-small` |
| AI platform | watsonx.ai Chat API (direct — no Orchestrate) |
| Validation | Zod |

---

## Prerequisites

- **Node.js 24 LTS** — recommended for this workspace and the migration CLI
- **pnpm 8+** — after installing Node.js: `npm install -g pnpm`
- **Docker Desktop** — https://www.docker.com/products/docker-desktop (for local PostgreSQL)
  - Alternative: install PostgreSQL directly and create a `fraudlens` user/database
- **IBM Cloud account** with access to the `watsonx Hackathon Sandbox` project

---

## First-time setup (run once)

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. Copy environment template and fill in your IBM credentials
cp -n .env.example apps/api/.env
# Edit apps/api/.env — see docs/IBM_WATSONX_SETUP.md for how to get IBM_ACCESS_TOKEN

# 3. Start local PostgreSQL database
docker compose up -d db
docker compose ps
# Wait until db is healthy.

# 4. Build the API (required so the TypeORM CLI can find dist/data-source.js)
pnpm --filter @fraud-intelligence/api build

# 5. Apply database migration (creates the transactions table and indexes)
pnpm --filter @fraud-intelligence/api migration:run

# 6. Place the team CSV under data/ (it is not in Git), then import it
node scripts/import-csv.mjs
```

---

On PowerShell, use `Copy-Item .env.example apps/api/.env` for step 2 only if the destination does not already exist.

The supplied CSV has a historical filename ending in `900k.csv`; the documented import used a distribution with 160,000 rows and loaded 158,701. See the [data contract](docs/data-contract.md). The API, migration CLI and importer use the Compose connection by default. For a custom database, export `DATABASE_URL` before running the migration and import, as those commands do not load `apps/api/.env`.

## Day-to-day development

```bash
# Start local database (if not already running)
docker compose up -d db

# Start API + web in parallel
pnpm dev

# Or individually:
pnpm --filter @fraud-intelligence/api start:dev
pnpm --filter @fraud-intelligence/web start:dev
```

Open the UI at [localhost:5173](http://localhost:5173) (or the URL printed by Vite) and investigate `EVT_SYN_000000001`. The API runs at `http://localhost:3001` by default.

Health check (PowerShell):
```powershell
Invoke-RestMethod http://localhost:3001/health
# → status : ok
```

Smoke test — investigate an imported transaction (PowerShell):
```powershell
Invoke-RestMethod -Method POST -Uri "http://localhost:3001/investigations" `
  -ContentType "application/json" `
  -Body '{"transactionId": "EVT_SYN_000000001"}'
```

Expected: JSON with `investigationId`, `report.riskLevel`, `report.toolsExecuted`, `report.explanation`.

---

## IBM credentials

IBM access tokens expire after approximately one hour.
See [`docs/IBM_WATSONX_SETUP.md`](docs/IBM_WATSONX_SETUP.md) for the full guide.

Put `IBM_PROJECT_ID` and `IBM_ACCESS_TOKEN` in `apps/api/.env` on macOS and
Windows, or export them before starting the API. The workspace starts NestJS
from `apps/api`; a root `.env` is not loaded automatically by the API.
After updating the token, restart the API. See the [credential guide](docs/IBM_WATSONX_SETUP.md)
for macOS/Linux and PowerShell instructions.

Never commit API keys, access tokens, or `.env` files with real values.

---

## Project status (2026-11-06)

| Component | Status |
|---|---|
| Monorepo + NestJS scaffold | ✅ Done (Sub-Task 1) |
| Docker Compose (PostgreSQL) | ✅ Done (Sub-Task 1) |
| Dataset inspection + data contract | ✅ Done (Sub-Task 2) |
| PostgreSQL schema + TypeORM migration | ✅ Done (Sub-Task 3) |
| DataService + foundational tools | ✅ Done (Sub-Task 3) |
| CSV import script | ✅ Done (Sub-Task 3) |
| WatsonxClient + AgentOrchestrator | ✅ Done (Sub-Task 4) |
| PolicyService + InvestigationService | ✅ Done (Sub-Task 5) |
| IBM integration — tool calling validated | ✅ Done |
| Analytical tools (velocity, spending, context) | ⏳ Sub-Task 6 |
| Remaining tools + full catalog | ⏳ Sub-Task 7 |
| React investigation UI | Integrated in development; production build fix pending (Sub-Task 8) |
| Evaluation harness | ⏳ Sub-Task 9 |

---

**Current demo limitation:** transaction details and customer profile come from PostgreSQL; velocity analysis is disabled until the PostgreSQL implementation is available. The customer profile uses the latest snapshot, which can postdate the investigated transaction. Use the current flow to demonstrate integration, not to validate risk classifications.

## Security notes

- The `feedback_label` column (fraud ground-truth) is never sent to the agent.
  It is reserved for offline evaluation (Sub-Task 9, pending).
- All tool calls are validated against a whitelist before execution.
- The agent's final report is validated via Zod before any action is taken.
- `requestMemberVerification` requires backend policy approval — it is not a free agent call.
