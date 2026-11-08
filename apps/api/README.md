# FraudLens API

NestJS backend for the Sicredi Fraud Intelligence MVP.

## Running locally

```bash
# From the repository root
pnpm install
cp -n .env.example apps/api/.env   # fill in IBM credentials
docker compose up -d db
# Wait for db to become healthy (docker compose ps).
pnpm --filter @fraud-intelligence/api build
pnpm --filter @fraud-intelligence/api migration:run
node scripts/import-csv.mjs   # first setup, once the CSV is in data/
pnpm --filter @fraud-intelligence/api start:dev
```

Health check: `curl http://localhost:3001/health`

See the [root setup](../../README.md#first-time-setup-run-once) and [IBM credential guide](../../docs/IBM_WATSONX_SETUP.md). The API uses PostgreSQL for transaction details and customer profile. The velocity tool is not registered in the API while its PostgreSQL implementation is pending.

## Scripts

| Script | Description |
|---|---|
| `start:dev` | Start in watch mode |
| `start:prod` | Start compiled build |
| `build` | Compile TypeScript |
| `test` | Run unit tests (vitest) |
| `test:e2e` | Run the endpoint integration tests; requires local PostgreSQL for app startup |
| `lint` | Run oxlint |

The existing e2e wiring test still expects the previous mock orchestrator response. Update that test to use a controlled model response before treating the suite as a release check.

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

## Authentication

Set `IBM_PROJECT_ID` and `IBM_API_KEY_FILE` in `apps/api/.env`. Use an absolute
path to a private JSON export containing `apikey`, preferably outside the repo.
The API obtains and renews tokens on demand in memory; it does not rewrite the
`.env`. Without the file setting, `IBM_ACCESS_TOKEN` remains supported manually.
