# ADR-003 — PostgreSQL + TypeORM for Data Persistence

**Status:** Accepted  
**Date:** 2026-10-22  
**Deciders:** Hello Moto team

---

## Context

The project needs a data layer for the Sicredi synthetic dataset (900k transactions,
297 columns). The initial approach considered loading the CSV directly into memory,
but this raises concerns about memory footprint and query flexibility.

Options considered:

1. **In-memory Map** — load CSV at startup, index by ID, no external dependency.
2. **SQLite + better-sqlite3** — file-based, no server needed, fast for reads.
3. **PostgreSQL + TypeORM** — full relational DB, explicit migrations, familiar to the team.

## Decision

Use **PostgreSQL** with **TypeORM**, `synchronize: false`, and explicit migrations.
Local development uses **Docker Compose** to run the database.

## Rationale

- The dataset inspection phase (Sub-Task 2) must happen before finalizing the
  data access implementation. The decision to use PostgreSQL is made now, but
  the schema is defined after inspecting the CSV columns.
- PostgreSQL enables range queries, aggregations (for velocity/spending analysis),
  and joins — patterns that in-memory Map implementations handle poorly.
- `synchronize: false` prevents accidental schema changes in any environment.
  All schema changes go through versioned migration files.
- Docker Compose makes local setup reproducible across all four developers without
  installing PostgreSQL natively.
- TypeORM is idiomatic in the NestJS ecosystem and provides a migration CLI that
  fits the pnpm workspace structure.

## Consequences

- `apps/api/` requires a `docker-compose.yml` (or a root-level one) with a
  PostgreSQL service.
- TypeORM entities must reflect only pre-authorization columns. `feedback_label`
  is never included in any entity exposed to the agent tools.
- `DataService` queries TypeORM repositories — it does not read the CSV directly
  at runtime after the import step.
- An import script (separate from the main app) loads the CSV into PostgreSQL once.
  This script lives in `scripts/import-data.mjs` (or similar) and is documented
  in the README.
- The PostgreSQL schema (tables, columns, indexes) is finalized in **Sub-Task 2**
  after inspecting the CSV header and the data dictionary.

## Development workflow

```bash
# Start the local database
docker compose up -d db

# Run migrations
pnpm --filter @fraud-intelligence/api migration:run

# Import the synthetic dataset (once)
node scripts/import-data.mjs

# Start the API
pnpm --filter @fraud-intelligence/api start:dev
```
