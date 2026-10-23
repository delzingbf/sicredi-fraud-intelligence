# ADR-002 — Direct watsonx.ai Chat API (No Orchestrate)

**Status:** Accepted  
**Date:** 2026-10-22  
**Deciders:** Hello Moto team

---

## Context

IBM watsonx Orchestrate provides a managed Agent Builder that handles the ReAct
loop, tool registration, and deployment automatically. The alternative is to call
the watsonx.ai Chat API directly and implement the tool-calling loop in the NestJS
backend.

The team attempted to use watsonx Orchestrate but found that the trial had expired
in the provisioned IBM AI Experiential Learning Lab account.

## Decision

Use the **watsonx.ai Chat API directly**, with a programmatic ReAct loop implemented
in `AgentOrchestrator` inside the NestJS backend.

## Rationale

- watsonx Orchestrate is **not available** in the current lab environment (trial
  expired). This is a hard constraint, not a preference.
- The direct Chat API approach was validated by the `test-tool-calling.mjs` PoC:
  the full loop (tool request → local execution → result injection → next round)
  works correctly with `ibm/granite-4-h-small`.
- Implementing the loop in NestJS keeps the tool execution logic inside the backend,
  which is where authorization, schema validation, and policy enforcement already live.
  There is no network hop to an external orchestration service.
- The direct API approach requires no publicly accessible tool endpoints during
  development — tools are executed as local function calls inside the same process.

## Consequences

- `AgentOrchestrator` is responsible for: building the message history, calling
  `WatsonxClient`, processing `tool_calls`, dispatching to `ToolRegistry`, enforcing
  the round limit, and extracting the final report.
- `WatsonxClient` is a thin HTTP wrapper — no business logic.
- The round limit (`MAX_INVESTIGATION_ROUNDS`) is enforced by the orchestrator code,
  not by the model.
- If Orchestrate becomes available later, the migration path is to replace
  `AgentOrchestrator` with an Orchestrate client adapter, keeping all other layers unchanged.

## Key implementation reference

`test-tool-calling.mjs` — validated loop pattern that `AgentOrchestrator` must mirror
in TypeScript. Notable quirks to preserve:
- `parseArguments`: double JSON.parse for Granite's serialized argument strings.
- `content` field in system/tool messages is an array: `[{type: "text", text: "..."}]`.
- `temperature: 0`, `tool_choice_option: "auto"`, `max_tokens: 1200`.
