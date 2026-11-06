# FraudLens Web

React, Vite and TypeScript interface for investigating card transactions.

From the repository root, follow the [initial setup](../../README.md#first-time-setup-run-once), then run `pnpm db:up` and `pnpm dev`. Open the URL printed by Vite (normally `http://localhost:5173`). To start only the web server, use `pnpm --filter @fraud-intelligence/web start:dev`.

Enter `EVT_SYN_000000001` after importing the team's CSV. The UI shows the report, lists the tools called, supports text export and offers simulated member verification when the API permits it. In development, Vite proxies `/investigations` and `/health` to `http://localhost:3001`. IBM credentials belong in the API configuration.

The UI works in development. The production build (`pnpm --filter @fraud-intelligence/web build`) currently hits TypeScript error `TS1294` in `src/api.ts`; correcting the `ApiError` constructor is pending. For demo evidence limitations, see the [project status](../../README.md#project-status-2026-11-06).
