# ADR-001 — Single Investigator Agent

**Status:** Accepted  
**Date:** 2026-10-22  
**Deciders:** Hello Moto team

---

## Context

The system needs an AI agent to investigate fraud in individual card transactions.
We considered two main architectural options:

1. **Single agent** with a dynamic tool catalog — one agent selects and calls
   tools as needed for each investigation.
2. **Multi-agent** — a supervisor agent delegates to specialized sub-agents
   (e.g., velocity specialist, geographic specialist).

## Decision

Use a **single investigator agent** for the MVP.

## Rationale

- The investigation domain is cohesive — all tools serve one goal (assess fraud
  risk for a single transaction) and share the same context window.
- Four developers, one MVP, limited timeline. Multi-agent adds: inter-agent
  communication protocol, routing logic, error propagation across agent boundaries,
  and harder observability. None of these costs are justified yet.
- The Granite 4 H Small model can handle ~10 tool definitions without degradation.
  Tool selection quality can be monitored before committing to specialization.
- Multi-agent remains a viable evolution path if: (a) single-agent tool selection
  quality degrades with more tools, or (b) parallel investigation sub-tasks are
  needed for performance reasons.

## Consequences

- `AgentOrchestrator` manages one linear ReAct loop per investigation.
- All tool definitions are registered in a single `ToolRegistry`.
- Simpler observability — one conversation thread per investigation to audit.
- If tool count grows beyond ~15, revisit this decision.
