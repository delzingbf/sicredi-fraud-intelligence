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

- **Node.js 18+** — https://nodejs.org (download the LTS version)
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
cp .env.example .env
# Edit .env — see docs/IBM_WATSONX_SETUP.md for how to get IBM_ACCESS_TOKEN

# 3. Start local PostgreSQL database
docker compose up -d db

# 4. Build the API (required so the TypeORM CLI can find dist/data-source.js)
pnpm --filter @fraud-intelligence/api build

# 5. Apply database migration (creates the transactions table and indexes)
pnpm --filter @fraud-intelligence/api migration:run

# 6. Import the synthetic dataset (900k rows — takes a few minutes)
node scripts/import-csv.mjs
```

---

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

Health check (PowerShell):
```powershell
Invoke-RestMethod http://localhost:3001/health
# → status : ok
```

Smoke test — run a real fraud investigation (PowerShell):
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

> **Important (Windows):** the `.env` file must be at `apps/api/.env`, not at the
> repo root. The NestJS process runs from `apps/api/` and reads `.env` relative to
> its working directory.

### Generating a token (PowerShell)

Run this once per session (or whenever the token expires). It generates the token
and writes it directly into `apps/api/.env` without displaying it on screen:

```powershell
$API_KEY = "your_ibm_api_key_here"

$response = Invoke-RestMethod `
  -Uri "https://iam.cloud.ibm.com/identity/token" `
  -Method POST `
  -ContentType "application/x-www-form-urlencoded" `
  -Body "grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=$API_KEY"

# Write token directly into apps/api/.env (replaces existing line)
$envPath = "apps\api\.env"
$content = Get-Content $envPath
$content = $content -replace "^IBM_ACCESS_TOKEN=.*", "IBM_ACCESS_TOKEN=$($response.access_token)"
$content | Set-Content $envPath

Write-Host "Token updated. Length: $($response.access_token.Length) chars"
```

The `start:dev` watch mode detects the `.env` change and restarts automatically.

Never commit API keys, access tokens, or `.env` files with real values.

---

## Project status (2026-11-04)

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
| React frontend | ⏳ Sub-Task 8 |
| Evaluation harness | ⏳ Sub-Task 9 |

---

## Security notes

- The `feedback_label` column (fraud ground-truth) is never sent to the agent.
  It is used only in the offline evaluation harness (`scripts/evaluate.mjs`).
- All tool calls are validated against a whitelist before execution.
- The agent's final report is validated via Zod before any action is taken.
- `requestMemberVerification` requires backend policy approval — it is not a free agent call.
