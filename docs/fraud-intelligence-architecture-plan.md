# FraudLens — Sicredi Fraud Intelligence — Architecture & Implementation Plan


## Status: SUPERSEDED

> **This document has been superseded.**
>
> It is preserved as a historical record of the initial architecture exploration
> and the reasoning that led to the current decisions.
>
> **Do not use this document as implementation guidance.**
> The authoritative plan is [`docs/implementation-plan.md`](implementation-plan.md).
>
> Key decisions that changed since this document was written:
> - watsonx Orchestrate is **not available** (trial expired) — the direct Chat API
>   path is now the confirmed approach.
> - The model confirmed available is `ibm/granite-4-h-small` (not Granite 3.x or
>   Mistral-Large as originally proposed).
> - Tools are **not** exposed as REST endpoints — they are executed as local
>   function calls inside `AgentOrchestrator` in the NestJS process.
> - PostgreSQL + TypeORM + Docker Compose was chosen as the data layer.
> - Architecture Decision Records are in [`docs/adr/`](adr/).

---

## 1. Top-Level Overview

**Goal:** Build an MVP of an agentic fraud investigation system for Sicredi using IBM watsonx.ai as the AI reasoning layer, with a NestJS backend exposing tool endpoints and a React/Vite frontend for visualization.

**Scope:**
- A single investigator agent (ReAct loop) running on watsonx.ai, backed by IBM Granite or Mixtral/Mistral-Large for tool-calling.
- A NestJS tool-service layer that exposes the fraud investigation tools as REST endpoints, backed by the synthetic CSV dataset.
- A lightweight React frontend to submit transactions, display investigation reports, and confirm/contest decisions.
- No real financial operations. All interventions are simulated.

**Non-goals:**
- Batch processing of all 900k transactions simultaneously.
- Custom model fine-tuning (not needed for MVP).
- Multi-agent system at MVP stage (can evolve post-MVP).
- Automatic card blocking or payment authorization.

**Immediate next session priority (confirmed by team):** Verify IBM lab account — identify available services, generate API key, and validate a single tool-calling invocation with Granite. This result determines whether to use Orchestrate (Tier 1) or direct chat API (Tier 2).

**Key decisions:**
- **Single agent** for the MVP — justified by scope, team size, and timeline.
- **watsonx.ai Agent Lab / chat API** as the agent runtime — watsonx Orchestrate Agent Builder is confirmed as the production path but the AI Experiential Lab environment must be verified before committing to that path.
- **Tools implemented in NestJS** — exposed as REST endpoints with a clear OpenAPI contract, callable from Python tool wrappers in the agent definition.
- **Fallback path:** If the provisioned watsonx account does not support Orchestrate Agent Builder, the agent can be implemented directly against the watsonx.ai chat/tool-calling REST API using Granite 3 or Mistral-Large from within the NestJS backend.

---

## 2. Architecture

### 2.1 Component Map

```
[React Frontend]
      |
      | HTTP/REST
      v
[NestJS Backend]
  ├── TransactionController   → receives investigation requests
  ├── ReportController        → returns investigation results
  ├── PolicyService           → deterministic safety policy (outside the agent)
  ├── AgentBridgeService      → calls watsonx.ai Agent or chat API
  └── ToolService layer
        ├── getTransactionDetails
        ├── getCustomerProfile
        ├── analyzeSpendingPattern
        ├── analyzeTransactionContext
        ├── analyzeTransactionVelocity
        ├── checkMerchantHistory
        ├── checkGeographicConsistency
        ├── checkCustomerRiskEvents
        ├── getRiskPolicy
        └── requestMemberVerification  (gated by PolicyService)

[watsonx.ai Agent]
  ├── Foundation Model: Granite 3.x or Mistral-Large (tool-calling capable)
  ├── System Prompt: investigator persona + constraints
  ├── Tool Definitions: JSON schemas matching NestJS endpoints
  └── ReAct loop → calls NestJS ToolService via HTTP

[Data Layer]
  └── CSV → loaded in-memory or indexed at startup (SQLite or in-memory for MVP)
```

### 2.2 Agent Architecture Decision

**Single Agent (chosen for MVP):**
- The investigator agent receives a transaction payload and autonomously selects tools.
- Uses a ReAct (Reason + Act) loop: reason about what to investigate → call a tool → observe result → reason again → repeat until confident or limit reached.
- Outputs a structured JSON report validated by the backend.

**Multi-agent (post-MVP evolution, not in scope now):**
- A supervisor agent could delegate to specialized sub-agents (velocity specialist, geographic specialist, etc.).
- Applicable only if single-agent accuracy proves insufficient or tool selection quality degrades with more than ~10 tools.

### 2.3 Boundary: Agent vs Backend

| Responsibility | Owner |
|---|---|
| Tool selection logic | Agent (LLM) |
| Reasoning about evidence | Agent (LLM) |
| Report generation | Agent (LLM) |
| Tool implementation (data access) | NestJS ToolService |
| Safety policy enforcement | NestJS PolicyService |
| Input/output schema validation | NestJS (Zod or class-validator) |
| Financial action execution | NestJS (simulated only) |
| Calling requestMemberVerification | NestJS PolicyService gates it |
| Labeling ground truth for evaluation | Offline evaluation harness |

---

## 3. watsonx.ai Platform Usage

### 3.1 Confirmed Capabilities (from IBM documentation)

- **Agent Lab (watsonx.ai):** Visual agent builder supporting custom tools defined as Python functions with JSON schema inputs. **NOTE: Agent Lab in watsonx.ai is being deprecated effective 13 Aug 2026. The replacement is watsonx Orchestrate Agent Lab/Builder.**
- **Chat API with tool calling:** Available via REST and Node.js SDK. Supports Granite 3.x (8b-instruct), Mistral-Large, and others. The model receives a list of tool definitions and autonomously selects which tool to call.
- **Custom tools in Agent Lab:** Defined with (a) a name+description, (b) a JSON input schema, (c) a Python function that runs inside the watsonx.ai runtime.
- **Programmatic deployment:** Agents can be deployed as AI services and invoked via the watsonx.ai REST API using IAM bearer tokens.
- **Governance/observability:** Metrics can be synchronized to watsonx.governance if available.

### 3.2 Recommended Approach by Tier

**Tier 1 — If watsonx Orchestrate is available in the lab account:**
- Use Orchestrate Agent Builder UI to configure the agent, register tools, and test.
- Expose NestJS tool endpoints publicly (or via IBM Cloud Code Engine) and register their OpenAPI specs as tools in Orchestrate.
- Call the deployed Orchestrate agent from NestJS via REST API with IAM token auth.

**Tier 2 — If only watsonx.ai (no Orchestrate) is available:**
- Implement the agent loop directly in NestJS using the `ibm-watsonx-ai` Node.js SDK.
- Define tools as JSON schemas in the NestJS code.
- The NestJS backend orchestrates the tool calls itself (tool-calling loop pattern).
- This is fully supported, documented, and requires no additional IBM services.

**Tier 3 — Fallback (if IBM cloud access is restricted):**
- Use watsonx.ai REST API directly with an API key.
- Implement the ReAct loop manually in NestJS.

**⚠️ Action required before implementation:** The team must log in to the IBM AI Experiential Learning Lab account and verify:
1. Whether watsonx Orchestrate is provisioned.
2. Which foundation models are available (specifically Granite 3.x instruct or Mistral-Large for tool-calling).
3. Whether the Agent Lab is accessible (note the Aug 2026 deprecation).
4. Whether deployment spaces are available for AI service deployments.

### 3.3 Recommended Foundation Model

- **First choice:** `ibm/granite-3-8b-instruct` or `ibm/granite-3-1-8b-instruct` — IBM's own model, tool-calling capable, confirmed in the documentation, good instruction-following.
- **Second choice:** `mistralai/mistral-large` — also confirmed with tool-calling, used in IBM's own quick tutorials.
- **Granite 4.x** — available in deploy-on-demand but likely requires additional billing; verify availability.
- **Do not fine-tune any model for the MVP.** The synthetic dataset labels should be used only for offline evaluation, not for training.

---

## 4. Tool Strategy

### 4.1 Tool Catalog Review

The proposed tools are well-conceived. The following adjustments are recommended:

| Decision | Justification |
|---|---|
| Keep all 10 tools as separate endpoints | Each has a distinct analytical purpose; merging would reduce the agent's selectivity |
| Implement getTransactionDetails and getCustomerProfile first | All other analyses depend on these two |
| analyzeSpendingPattern, analyzeTransactionContext, analyzeTransactionVelocity are medium priority | They add signal but are not blockers |
| checkGeographicConsistency is lower priority for MVP | Geographic fields may be sparse in the synthetic dataset |
| getRiskPolicy should be a static/embedded response for MVP | No need for a database call; embed policy as a config file |
| requestMemberVerification must be gated | NestJS PolicyService must approve it before execution; agent cannot trigger it directly |

### 4.2 Tool Contract Standard

Every tool must return a JSON object with this envelope:

```json
{
  "status": "success" | "not_found" | "unavailable" | "error",
  "data": { ... } | null,
  "metadata": {
    "tool": "toolName",
    "timestamp": "ISO-8601",
    "dataSource": "synthetic-csv",
    "missingFields": ["field1", "field2"]
  },
  "message": "optional human-readable note"
}
```

This ensures the agent can distinguish absence-of-data from errors, and prevents hallucination caused by empty responses.

### 4.3 CSV Data Access Strategy

- **At startup:** Load the CSV into memory using a lightweight parser (e.g., `papaparse` or `csv-parse`).
- **Index by:** `transaction_id`, `customer_id`, `merchant_id` using a JavaScript `Map` for O(1) lookups.
- **For analytical tools (velocity, pattern):** Pre-aggregate per customer on startup or compute lazily on first access.
- **Do NOT expose the `fraud_label` field to the agent.** It must be excluded from all tool responses.
- **Post-MVP:** If CSV lookups become slow, migrate to SQLite (via `better-sqlite3`) or PostgreSQL.

---

## 5. Investigation Report Contract

The agent's final output must conform to this JSON schema (enforced by the backend via Zod):

```json
{
  "transactionId": "string",
  "riskLevel": "LOW_RISK" | "SUSPICIOUS" | "HIGH_RISK" | "INCONCLUSIVE",
  "recommendedAction": "PROCEED" | "REQUEST_MEMBER_VERIFICATION" | "MANUAL_REVIEW",
  "toolsExecuted": ["toolName"],
  "evidenceFor": ["string"],
  "evidenceAgainst": ["string"],
  "missingInformation": ["string"],
  "contradictions": ["string"],
  "explanation": "string",
  "requiresHumanReview": true | false,
  "confidence": "LOW" | "MEDIUM" | "HIGH"
}
```

**Key constraint:** `confidence` is a qualitative self-assessment by the agent, not a calibrated probability. The report must not present it as a statistical probability of fraud.

---

## 6. Safety & Security Strategy

### 6.1 Rules that live outside the agent

- **PolicyService** in NestJS enforces:
  - `requestMemberVerification` requires explicit policy approval per transaction.
  - Maximum tool iterations: default 8, configurable per investigation.
  - Timeout: 30 seconds per investigation.
  - The agent's `riskLevel` and `recommendedAction` are validated against a Zod schema before any downstream action.
  - Ground-truth labels (`fraud_label`) are never included in tool responses.

### 6.2 Preventing hallucination

- All tool responses include a `status` field — the agent prompt explicitly instructs it to note unavailable data.
- Tools return structured data, never free-text narratives. The agent synthesizes the narrative.
- System prompt includes a constraint: "Only state conclusions that are directly supported by tool outputs received. If evidence is absent or contradictory, declare INCONCLUSIVE."

### 6.3 Evaluation Strategy

- **Offline evaluation harness** (separate from the live system):
  - Select a stratified sample from the 900k dataset (e.g., 500 transactions: ~50 fraud, 450 legitimate).
  - Run the agent on each transaction.
  - Compare `riskLevel` against the ground-truth `fraud_label`.
  - Metrics: Precision, Recall, F1 (macro and weighted), AUPRC (since the dataset is highly imbalanced — 0.1% fraud).
  - **Do NOT use accuracy** as the primary metric on an imbalanced dataset.
- **Tool call quality:** Log which tools were called per investigation. Manually audit 10-20 cases to verify the selection made sense.
- **Latency:** Measure end-to-end investigation time and watsonx.ai inference cost per investigation.

---

## 7. Implementation Plan

### Sub-task 1 — Environment Setup & Data Pipeline
**Intent:** Establish the project structure, load the synthetic CSV, and expose the two foundational data endpoints.
**Status:** [ ] pending

**Todo:**
1. Initialize the NestJS project (`nest new`), configure TypeScript strict mode.
2. Initialize the React + Vite + TypeScript frontend project.
3. Set up a shared monorepo (e.g., `pnpm workspaces`) or separate repos (simpler for the team).
4. Load the CSV at startup in a `DataService` — index transactions, customers, and merchants.
5. Implement `getTransactionDetails` and `getCustomerProfile` endpoints with the standard response envelope.
6. Write unit tests for data loading and both endpoints.
7. Verify the IBM lab account: which watsonx services are available, which foundation models, API key generation.

**Relevant Context:**
- Data files must be inspected first: `dicionario_dados_case_prevencao_sicredi.xlsx` and the CSV header.
- The `fraud_label` column must be identified and excluded from all tool responses.

**Criteria:** Both endpoints return correct data from the CSV; data loads in under 5 seconds; lab account verified.

---

### Sub-task 2 — Analytical Tool Layer
**Intent:** Implement the remaining 6 analytical tools with real logic backed by the CSV data.
**Status:** [ ] pending

**Todo:**
1. Implement `analyzeSpendingPattern` — compare transaction value vs. customer median/std dev.
2. Implement `analyzeTransactionContext` — hour-of-day, channel, transaction type anomaly flags.
3. Implement `analyzeTransactionVelocity` — count transactions within configurable time windows.
4. Implement `checkMerchantHistory` — aggregate merchant statistics (avg value, fraud flags if any in history).
5. Implement `checkGeographicConsistency` — distance/time plausibility between recent transactions (only if the CSV has usable location fields).
6. Implement `checkCustomerRiskEvents` — query prior alert/event records from the synthetic dataset.
7. Write unit tests for each tool.
8. Create OpenAPI/Swagger docs for all tool endpoints using NestJS decorators.

**Criteria:** All 6 tools return well-formed responses; handle missing fields gracefully; tests pass.

---

### Sub-task 3 — Policy & Intervention Tools
**Intent:** Implement the two policy/intervention tools with appropriate safety gates.
**Status:** [ ] pending

**Todo:**
1. Implement `getRiskPolicy` as a static config-driven response (no DB needed).
2. Implement `requestMemberVerification` with a `PolicyService` gate.
3. Define `PolicyService` rules: which risk levels and conditions can trigger member verification.
4. Implement the report schema validation in NestJS using Zod or `class-validator`.
5. Write integration tests covering policy enforcement.

**Criteria:** `requestMemberVerification` cannot be triggered by the agent directly without policy approval; report validation rejects malformed agent output.

---

### Sub-task 4 — Agent Integration (watsonx.ai)
**Intent:** Wire the agent to the tool layer and produce the first end-to-end investigation.
**Status:** [ ] pending

**Todo:**
1. Based on lab account verification, choose Tier 1 (Orchestrate) or Tier 2 (direct chat API).
2. Write the system prompt for the investigator agent (persona, constraints, output format instructions).
3. Define tool schemas for all 10 tools as JSON tool definitions (for the chat API) or register them in Orchestrate.
4. Implement the `AgentBridgeService` in NestJS — it receives a transaction ID, calls the agent, parses the structured report, and validates it.
5. Implement the tool-calling loop in `AgentBridgeService` if using Tier 2 (direct chat API).
6. Add a max-iterations guard (default: 8 rounds).
7. Test with 5 known fraud transactions and 5 known legitimate transactions from the dataset.

**Criteria:** Agent produces a valid structured report for at least 8 out of 10 test transactions without hallucination.

---

### Sub-task 5 — Frontend & Visualization
**Intent:** Build a minimal UI for submitting transactions and displaying investigation results.
**Status:** [ ] pending

**Todo:**
1. Build a transaction submission form (transaction ID input or random sample selector).
2. Build an investigation report viewer — display all report fields in a structured, readable layout.
3. Add a `requestMemberVerification` confirmation dialog (simulated — no real SMS/push).
4. Add an investigation trace view — list of tools called in order, with their results.
5. Connect to the NestJS backend via REST.

**Criteria:** A user can submit a transaction ID and see the full investigation report and tool trace in the browser.

---

### Sub-task 6 — Evaluation Harness
**Intent:** Enable systematic quality measurement of the agent's classifications.
**Status:** [ ] pending

**Todo:**
1. Build a script that samples N transactions (stratified by fraud/non-fraud label).
2. Runs each through the full investigation pipeline.
3. Compares `riskLevel` against the ground-truth `fraud_label`.
4. Outputs a metrics report: precision, recall, F1, AUPRC, confusion matrix.
5. Logs tool selection patterns per investigation.

**Criteria:** Harness runs on at least 100 transactions and produces a metrics report.

---

## 8. Team Division of Responsibilities

| Developer | Primary Focus | Secondary |
|---|---|---|
| Dev A | NestJS backend — DataService, analytical tools (Sub-tasks 1, 2) | Support agent prompt engineering |
| Dev B | NestJS backend — PolicyService, intervention tools, report validation (Sub-task 3) | Integration tests |
| Dev C | watsonx.ai agent integration, AgentBridgeService, system prompt (Sub-task 4) | Evaluation harness (Sub-task 6) |
| Dev D | React frontend (Sub-task 5), evaluation harness (Sub-task 6) | CSV analysis and data dictionary exploration |

All four developers should jointly examine the data dictionary and CSV structure before Sub-task 1 begins.

---

## 9. First Proof of Concept

**Goal:** In the shortest path possible, demonstrate that the agent can investigate a single transaction end-to-end.

**Steps:**
1. Inspect the CSV and data dictionary to identify available pre-authorization fields. (1 session, all devs)
2. Implement `getTransactionDetails` and `getCustomerProfile` with mock CSV data. (Dev A, 1 session)
3. Create a watsonx.ai project, generate an API key, and test a single tool-calling request via Curl or the Node.js SDK against Granite 3.1 8b-instruct. (Dev C, 1 session)
4. Write a minimal `AgentBridgeService` that calls the agent with only 2 tools registered. (Dev C, 1 session)
5. Run the agent against one known fraud transaction and one legitimate transaction. (all devs review)
6. Review the agent's reasoning and adjust the system prompt accordingly.

**This PoC validates three critical unknowns before committing to the full build:**
- Does the provisioned IBM lab account support the needed foundation model?
- Is the tool-calling loop working as expected with our JSON schemas?
- Is the agent's reasoning about the transaction data coherent?

---

## 10. Open Questions (to resolve before implementation)

1. **Lab account access:** Which watsonx products are provisioned? (Orchestrate vs. watsonx.ai only)
2. **CSV data leakage:** Which fields are available pre-authorization? The data dictionary must be reviewed to exclude post-authorization fields from all tool responses.
3. **CSV location fields:** Do usable geographic coordinates exist? If not, `checkGeographicConsistency` must be simplified or deferred.
4. **Tool hosting:** Will NestJS be deployed to IBM Cloud Code Engine, or will it run locally via ngrok during the MVP? (Orchestrate requires a publicly reachable URL for tool endpoints.)
5. **Agent runtime timeout:** What is the maximum execution time for an agent invocation in the lab environment?
6. **Report schema evolution:** Should the JSON schema be versioned from day one?

---

## 11. Guide: Verifying the IBM AI Experiential Learning Lab Account

### Step-by-step

1. Access `cloud.ibm.com` and log in with the program credentials.
2. In the top menu, click the hamburger icon → **Resource list**.
3. Look for services named:
   - `watsonx.ai` → confirms access to AI studio and Prompt Lab
   - `watsonx Orchestrate` → confirms access to Agent Builder
   - `Watson Machine Learning` → needed for AI service deployments
4. **To generate an API key:** Manage → Access (IAM) → API keys → Create an IBM Cloud API key. Store it — it cannot be recovered after creation.
5. **To verify available models:** open watsonx.ai → create or open a project → go to Prompt Lab → click "Foundation model" → list all models. Confirm whether `ibm/granite-3-1-8b-instruct` or `mistralai/mistral-large` appear.

### Testing tool-calling via curl

```bash
# Replace MY_APIKEY and MY_PROJECT_ID with real values
TOKEN=$(curl -s -X POST 'https://iam.cloud.ibm.com/identity/token' \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  -d 'grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=MY_APIKEY' \
  | jq -r '.access_token')

curl -X POST "https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2023-05-29" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "model_id": "ibm/granite-3-1-8b-instruct",
    "project_id": "MY_PROJECT_ID",
    "messages": [{"role": "user", "content": "What is 3 plus 5?"}],
    "tools": [{
      "type": "function",
      "function": {
        "name": "add_numbers",
        "description": "Adds two integers and returns the sum",
        "parameters": {
          "type": "object",
          "properties": {
            "a": {"type": "integer", "description": "First number"},
            "b": {"type": "integer", "description": "Second number"}
          },
          "required": ["a", "b"]
        }
      }
    }],
    "tool_choice_option": "auto"
  }'
```

**Interpreting the result:**
- If the response contains `"tool_calls"` → tool-calling works. Tier 2 (direct chat API) is confirmed.
- If the model responds with plain text only → the model may not support tool-calling; try `mistralai/mistral-large` instead.
- If you get a 404 or 403 → verify region endpoint (try `eu-de.ml.cloud.ibm.com` for Frankfurt) and check project ID.

### If watsonx Orchestrate is available

1. Open Orchestrate → Agent Builder → create a test agent.
2. Register a simple "ping" tool with a single `message` string input.
3. Confirm the agent can call the tool and return a response.
4. If successful → the project can use Tier 1 (Orchestrate) for the production agent.
