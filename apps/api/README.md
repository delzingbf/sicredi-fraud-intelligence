# FraudLens API

NestJS backend for the Sicredi Fraud Intelligence MVP.

## Running locally

```bash
# From the repository root
pnpm install
cp .env.example .env   # fill in IBM credentials — see docs/IBM_WATSONX_SETUP.md
docker compose up -d db
pnpm --filter @fraud-intelligence/api start:dev
```

Health check: `curl http://localhost:3001/health`

## Scripts

| Script | Description |
|---|---|
| `start:dev` | Start in watch mode |
| `start:prod` | Start compiled build |
| `build` | Compile TypeScript |
| `test` | Run unit tests (vitest) |
| `test:e2e` | Run e2e tests |
| `lint` | Run oxlint |

## Module structure

```
src/
├── config/           Environment variable validation (Zod)
├── health/           GET /health
├── investigation/    POST /investigations  (Sub-Task 5)
├── agent/            WatsonxClient + AgentOrchestrator + ToolRegistry (Sub-Task 4)
├── policy/           PolicyService (Sub-Task 5)
├── data/             DataService — PostgreSQL access (Sub-Task 3)
└── tools/            Tool implementations (Sub-Tasks 3, 6, 7)
```

See [`../../docs/implementation-plan.md`](../../docs/implementation-plan.md) for the full plan.
