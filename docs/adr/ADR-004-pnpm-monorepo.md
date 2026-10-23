# ADR-004 — pnpm Workspaces Monorepo

**Status:** Accepted  
**Date:** 2026-10-22  
**Deciders:** Hello Moto team

---

## Context

The project has two deployable applications (NestJS API, React web) and shared
TypeScript types. We need to decide whether to use separate repositories, a
monorepo, or a simple shared package.

## Decision

Use a **pnpm workspaces monorepo** with the following workspace packages:

- `apps/api` — NestJS backend
- `apps/web` — React + Vite frontend
- `packages/contracts` — shared TypeScript types

## Rationale

- `packages/contracts` must be importable from both `apps/api` and `apps/web` with
  type safety. A monorepo workspace dependency (`"@fraud-intelligence/contracts": "workspace:*"`)
  achieves this without publishing to a registry.
- pnpm workspaces have better performance and stricter dependency isolation than
  npm or yarn equivalents.
- A single repository simplifies cross-package refactoring, pull requests that span
  `api` and `web`, and shared CI configuration.
- The team is small (4 developers) — the overhead of coordinating multiple
  repositories would outweigh any isolation benefit.

## Consequences

- Root `package.json` is private and contains only workspace-level dev tooling
  (lint, TypeScript, etc.).
- `pnpm-workspace.yaml` lists `apps/*` and `packages/*`.
- Each package has its own `package.json`, `tsconfig.json`, and build output.
- `apps/api/tsconfig.json` includes a path alias for `@fraud-intelligence/contracts`.
- Commands are scoped with `pnpm --filter <package-name> <script>`.
