# ADR-005 — Zod for Agent Contract Validation

**Status:** Accepted  
**Date:** 2026-10-22  
**Deciders:** Hello Moto team

---

## Context

The `AgentOrchestrator` receives the final investigation report as text from the
model. This text must be parsed as JSON and validated against the `InvestigationReport`
contract before any downstream action (policy enforcement, API response, member
verification).

Options considered:

1. **Manual type guard** — cast the parsed JSON and check fields manually.
2. **`class-validator` + `class-transformer`** — NestJS-native, decorator-based.
3. **Zod** — schema-first, type inference, parse-not-cast pattern, no decorators.

## Decision

Use **Zod** for validating the `InvestigationReport` output from the agent and
for the HTTP request DTO through a per-route `ZodValidationPipe`.

## Rationale

- Zod's `safeParse` returns a discriminated union (`success/error`) — the exact
  pattern needed for `InvestigationService`'s fallback logic (malformed report →
  return `INCONCLUSIVE`).
- Schema-first: the Zod schema is the single source of truth. The TypeScript type
  is derived from it via `z.infer<>`, avoiding drift between runtime validation
  and compile-time types.
- Zod works equally well in Node.js and browser environments, making it compatible
  with `packages/contracts` if client-side validation is ever needed.
- `class-validator` requires decorators and is less ergonomic for validating
  arbitrary JSON payloads (like the agent's output).

## Consequences

- `packages/contracts` exports TypeScript types only — no Zod schemas
  (schemas include runtime code that should stay in the consuming package).
- `apps/api/src/policy/` contains the Zod schemas that mirror the `contracts` types.
- When `InvestigationReport` types change, the Zod schema in `policy/` must be
  updated in the same commit.
- `PolicyService.validate(rawJson)` uses `InvestigationReportSchema.safeParse()`
  and returns `{ ok: true, report }` or `{ ok: false, issues }`; validation failures do not throw.
