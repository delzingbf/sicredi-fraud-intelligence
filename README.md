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
| [`docs/adr/`](docs/adr/) | Architecture Decision Records |
| [`docs/backlog.md`](docs/backlog.md) | GitHub issue proposals |
| [`AGENTS.md`](AGENTS.md) | Context for AI coding assistants |
| [`docs/poc/test-tool-calling.mjs`](docs/poc/test-tool-calling.mjs) | Validated PoC (after Sub-Task 1 moves it from root) |

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

- Node.js 18+
- pnpm 8+
- Docker (for local PostgreSQL)
- IBM Cloud account with access to the `watsonx Hackathon Sandbox` project

---

## Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment template and fill in your values
cp .env.example .env
# Edit .env — see docs/IBM_WATSONX_SETUP.md for IBM credentials

# 3. Start local database
docker compose up -d db

# 4. Run database migrations (once DataService is implemented — Sub-Task 3)
pnpm --filter @fraud-intelligence/api migration:run

# 5. Import synthetic dataset (once — Sub-Task 3)
node scripts/import-data.mjs

# 6. Start everything (api + web in parallel)
pnpm dev

# Or start individually:
pnpm --filter @fraud-intelligence/api start:dev
pnpm --filter @fraud-intelligence/web start:dev
```

Health check: `curl http://localhost:3001/health` → `{ "status": "ok" }`

---

## IBM credentials

IBM access tokens expire after approximately one hour.
See [`docs/IBM_WATSONX_SETUP.md`](docs/IBM_WATSONX_SETUP.md) for the full guide.

Quick reference:

```zsh
# Set project ID (safe to share — not a secret)
export IBM_PROJECT_ID='e696fb51-b4b0-4e13-8478-c66e8e9002ed'

# Enter API key securely (input is hidden)
read -r -s 'IBM_API_KEY?API key: '
export IBM_API_KEY

# Exchange for bearer token
# (see docs/IBM_WATSONX_SETUP.md section 4 for the full script)
```

Never commit API keys, access tokens, or `.env` files with real values.

---

## Project status (2026-10-22)

| Component | Status |
|---|---|
| IBM integration — tool calling validated | ✅ Done |
| Monorepo + NestJS scaffold | ✅ Done |
| React + Vite scaffold | ✅ Done |
| Docker Compose (PostgreSQL) | ✅ Done |
| PostgreSQL + TypeORM migrations | ⏳ Sub-Task 3 |
| Dataset inspection + data contract | ⏳ Sub-Task 2 |
| DataService + foundational tools | ⏳ Sub-Task 3 |
| WatsonxClient + AgentOrchestrator | ⏳ Sub-Task 4 |
| PolicyService + InvestigationService | ⏳ Sub-Task 5 |
| Analytical tools (velocity, spending, context) | ⏳ Sub-Task 6 |
| Remaining tools + full catalog | ⏳ Sub-Task 7 |
| React frontend | ⏳ Sub-Task 8 |
| Evaluation harness | ⏳ Sub-Task 9 |

---

## Security notes

- The `feedback_label` column (fraud ground-truth) is never sent to the agent.
  It is used only in the offline evaluation harness.
- All tool calls are validated against a whitelist before execution.
- The agent's final report is validated via Zod before any action is taken.
- `requestMemberVerification` requires backend policy approval — it is not a free agent call.
