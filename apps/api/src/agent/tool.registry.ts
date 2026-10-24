import { Injectable, Logger } from '@nestjs/common';
import type { ToolResult } from '@fraud-intelligence/contracts';
import type { IbmToolDefinition } from './watsonx.client.js';

// ─── Tool registration types ──────────────────────────────────────────────────

/**
 * A plain function that receives validated arguments and returns a ToolResult.
 * Implementations must never throw — return status:'error' for failure cases.
 */
export type ToolImplementation = (args: Record<string, unknown>) => Promise<ToolResult> | ToolResult;

/** Everything needed to register one tool in the catalog. */
export interface ToolRegistration {
  /** JSON definition sent to the model so it knows when/how to call the tool. */
  definition: IbmToolDefinition;
  /** The actual function executed when the model requests this tool. */
  implementation: ToolImplementation;
}

// ─── ToolRegistry ─────────────────────────────────────────────────────────────

/**
 * ToolRegistry — single source of truth for all fraud investigation tools.
 *
 * Responsibilities:
 *   - Maintain the catalog of available tools and their JSON definitions.
 *   - Enforce a whitelist: tools not registered here cannot be called.
 *   - Parse and validate tool arguments before dispatching.
 *   - Execute the implementation and wrap unexpected throws in a ToolResult error.
 *
 * AgentOrchestrator calls getDefinitions() to build every IBM request and
 * execute() for each tool_call the model returns.
 *
 * Tool implementations are registered at module startup by each tool file
 * (Sub-Tasks 3, 6, 7).  During Sub-Task 4 two mock tools are pre-registered
 * so the orchestrator loop can be tested end-to-end before real data exists.
 */
@Injectable()
export class ToolRegistry {
  private readonly logger = new Logger(ToolRegistry.name);
  private readonly catalog = new Map<string, ToolRegistration>();

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Register a tool.  Called once per tool at startup (in AgentModule providers
   * or via an OnModuleInit hook when real tools are added in Sub-Tasks 3+).
   *
   * Calling register() with the same name twice overwrites the previous entry
   * so test doubles can replace production implementations.
   */
  register(name: string, registration: ToolRegistration): void {
    this.catalog.set(name, registration);
    this.logger.debug(`Registered tool: ${name}`);
  }

  /**
   * Returns the tool definitions array ready to be sent to IBM.
   * AgentOrchestrator passes this directly into the `tools` field of every
   * WatsonxClient.chat() call.
   */
  getDefinitions(): IbmToolDefinition[] {
    return [...this.catalog.values()].map((r) => r.definition);
  }

  /**
   * Execute a tool by name.
   *
   * Security:
   *   - Unknown names → ToolResult with status 'error' (whitelist enforced).
   *   - Arguments are parsed via parseArguments() before dispatch.
   *   - Unexpected throws inside the implementation are caught and wrapped.
   *
   * Never throws — always returns a ToolResult.
   */
  async execute(
    name: string,
    rawArguments: unknown,
  ): Promise<ToolResult> {
    const registration = this.catalog.get(name);

    if (!registration) {
      this.logger.warn(`Tool not in whitelist: "${name}"`);
      return this.errorResult(name, `Tool "${name}" is not registered`);
    }

    let args: Record<string, unknown>;
    try {
      args = parseArguments(rawArguments);
    } catch (err) {
      this.logger.warn(`Invalid arguments for tool "${name}": ${String(err)}`);
      return this.errorResult(name, `Invalid arguments for tool "${name}"`);
    }

    try {
      return await registration.implementation(args);
    } catch (err) {
      this.logger.error(`Tool "${name}" threw unexpectedly`, err);
      return this.errorResult(
        name,
        `Tool "${name}" encountered an unexpected error`,
      );
    }
  }

  /** Total number of registered tools. Used in tests and health checks. */
  get size(): number {
    return this.catalog.size;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private errorResult(toolName: string, message: string): ToolResult {
    return {
      status: 'error',
      data: null,
      metadata: { tool: toolName, dataSource: 'none', missingFields: [] },
      message,
    };
  }
}

// ─── parseArguments (exported for AgentOrchestrator) ─────────────────────────

/**
 * Normalise tool arguments from the model response.
 *
 * Granite 4 H Small (and some other IBM models) occasionally serialises
 * `tool_call.function.arguments` as a JSON string instead of a plain object.
 * This function handles both cases by attempting up to two JSON.parse passes.
 *
 * Throws if the result is not a non-null, non-array object.
 */
export function parseArguments(raw: unknown): Record<string, unknown> {
  let value: unknown = raw;

  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    value = JSON.parse(value);
  }

  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value)
  ) {
    throw new Error(`Expected an object, got: ${JSON.stringify(value)}`);
  }

  return value as Record<string, unknown>;
}
