import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnv } from '../config/app.config.js';
import { AgentError } from './agent.orchestrator.interface.js';

// ─── IBM Chat API types ───────────────────────────────────────────────────────

/** A single tool call requested by the model in one response message. */
export interface IbmToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    /** May be a plain object OR a JSON-serialised string — see parseArguments(). */
    arguments: unknown;
  };
}

/** One message in the conversation history sent to IBM. */
export type IbmMessage =
  | { role: 'system'; content: Array<{ type: 'text'; text: string }> }
  | { role: 'user'; content: Array<{ type: 'text'; text: string }> }
  | { role: 'assistant'; content: string | null; tool_calls?: IbmToolCall[] }
  | {
      role: 'tool';
      tool_call_id: string;
      content: Array<{ type: 'text'; text: string }>;
    };

/** Tool definition sent to the model in each request. */
export interface IbmToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description?: string }>;
      required?: string[];
    };
  };
}

/** The message object returned by IBM inside choices[0].message. */
export interface IbmResponseMessage {
  role: 'assistant';
  /** null when the model only produced tool_calls and no text. */
  content: string | null;
  tool_calls?: IbmToolCall[];
}

// ─── WatsonxClient ────────────────────────────────────────────────────────────

/**
 * WatsonxClient — thin HTTP wrapper around the IBM watsonx.ai Chat API.
 *
 * Responsibilities:
 *   - Build the correct request body (project_id, model_id, parameters).
 *   - Attach the IAM bearer token from env.
 *   - Return the raw assistant message for the caller to process.
 *   - Throw AgentError('IBM_ERROR') on any non-2xx or network failure.
 *   - Respect the AbortSignal so in-flight requests are cancelled on timeout.
 *
 * Non-responsibilities:
 *   - No loop logic, no tool dispatching, no JSON parsing of the report.
 *   - No retries (keeps latency predictable within a single investigation).
 */
@Injectable()
export class WatsonxClient {
  private readonly logger = new Logger(WatsonxClient.name);

  private readonly url: string;
  private readonly projectId: string;
  private readonly modelId: string;

  /** Fixed inference parameters validated experimentally with Granite 4 H Small. */
  private static readonly TEMPERATURE = 0;
  private static readonly MAX_TOKENS = 1200;
  private static readonly TOOL_CHOICE_OPTION = 'auto';

  constructor(private readonly config: ConfigService<AppEnv, true>) {
    this.url = this.config.get('IBM_CHAT_API_URL', { infer: true });
    this.projectId = this.config.get('IBM_PROJECT_ID', { infer: true });
    this.modelId = this.config.get('IBM_MODEL_ID', { infer: true });
  }

  /**
   * Send the current message history to IBM and return the assistant message.
   *
   * @param messages  Full conversation history including system prompt.
   * @param tools     Tool definitions available to the model.
   * @param signal    AbortSignal from the investigation timeout controller.
   * @throws AgentError('IBM_ERROR') on non-2xx response or network failure.
   */
  async chat(
    messages: IbmMessage[],
    tools: IbmToolDefinition[],
    signal: AbortSignal,
  ): Promise<IbmResponseMessage> {
    const token = this.config.get('IBM_ACCESS_TOKEN', { infer: true });

    const body = {
      project_id: this.projectId,
      model_id: this.modelId,
      messages,
      tools,
      tool_choice_option: WatsonxClient.TOOL_CHOICE_OPTION,
      temperature: WatsonxClient.TEMPERATURE,
      max_tokens: WatsonxClient.MAX_TOKENS,
    };

    let response: Response;

    try {
      response = await fetch(this.url, {
        method: 'POST',
        signal,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network failure or AbortError (timeout).
      // Let AbortError propagate so InvestigationService can classify it as TIMEOUT.
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      this.logger.error('IBM Chat API network error', err);
      throw new AgentError('IBM_ERROR', `IBM Chat API network error: ${String(err)}`);
    }

    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as Record<string, unknown>;
        detail += ` — ${JSON.stringify(body)}`;
      } catch {
        // ignore parse failure; detail already has the status code
      }
      this.logger.error(`IBM Chat API returned ${detail}`);
      throw new AgentError('IBM_ERROR', `IBM Chat API error: ${detail}`);
    }

    const data = (await response.json()) as {
      choices: Array<{ message: IbmResponseMessage }>;
    };

    return data.choices[0].message;
  }
}
