import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { InvestigationRequest } from '@fraud-intelligence/contracts';
import type { AppEnv } from '../config/app.config.js';
import {
  AgentError,
  type AgentResult,
  type IAgentOrchestrator,
} from './agent.orchestrator.interface.js';
import { WatsonxClient, type IbmMessage } from './watsonx.client.js';
import { ToolRegistry } from './tool.registry.js';
import { SYSTEM_PROMPT } from './system-prompt.js';

/**
 * AgentOrchestrator — implements the ReAct (Reason + Act) investigation loop.
 *
 * This is a direct TypeScript port of the validated PoC in
 * docs/poc/test-tool-calling.mjs, extended to:
 *   - use NestJS dependency injection (WatsonxClient, ToolRegistry, ConfigService)
 *   - respect the AbortSignal supplied by InvestigationService (timeout gate)
 *   - track an authoritative toolsExecuted list (not self-reported by the model)
 *   - throw typed AgentErrors so InvestigationService can build safe fallbacks
 *
 * Loop per round:
 *   1. Call WatsonxClient.chat() with the current message history.
 *   2. Push the assistant message onto the history.
 *   3. If the message has no tool_calls → model is done; attempt JSON correction if needed.
 *   4. For each tool_call: execute via ToolRegistry, push tool result onto history.
 *   5. If MAX_INVESTIGATION_ROUNDS reached → throw AgentError('ROUND_LIMIT').
 *
 * JSON correction (Granite markdown fence workaround):
 *   When the model's final content is not valid JSON, a single correction round is
 *   attempted.  The correction message has no tools so the model cannot call further
 *   tools.  If the corrected response is still not valid JSON, the raw text is
 *   returned anyway — InvestigationService owns the final parse + fallback.
 */
@Injectable()
export class AgentOrchestrator implements IAgentOrchestrator {
  private readonly logger = new Logger(AgentOrchestrator.name);
  private readonly maxRounds: number;

  constructor(
    private readonly watsonx: WatsonxClient,
    private readonly toolRegistry: ToolRegistry,
    @Inject(ConfigService)
    private readonly config: ConfigService<AppEnv, true>,
  ) {
    this.maxRounds = this.config.get('MAX_INVESTIGATION_ROUNDS', { infer: true });
  }

  async investigate(
    request: InvestigationRequest,
    signal: AbortSignal,
  ): Promise<AgentResult> {
    const toolsExecuted: string[] = [];

    // ── Build initial message history ────────────────────────────────────────
    const messages: IbmMessage[] = [
      {
        role: 'system',
        content: [{ type: 'text', text: SYSTEM_PROMPT }],
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildUserMessage(request),
          },
        ],
      },
    ];

    const toolDefinitions = this.toolRegistry.getDefinitions();

    // ── ReAct loop ───────────────────────────────────────────────────────────
    for (let round = 0; round < this.maxRounds; round++) {
      // Stop immediately if the investigation was cancelled externally.
      if (signal.aborted) {
        throw new AgentError('TIMEOUT', 'AbortSignal fired before round started');
      }

      this.logger.debug(`Round ${round + 1}/${this.maxRounds} for ${request.transactionId}`);

      const assistantMessage = await this.watsonx.chat(messages, toolDefinitions, signal);

      // Push assistant turn onto history before processing tool calls.
      messages.push({
        role: 'assistant',
        content: assistantMessage.content,
        tool_calls: assistantMessage.tool_calls,
      });

      const toolCalls = assistantMessage.tool_calls ?? [];

      // ── No tool calls → model concluded the investigation ─────────────────
      if (toolCalls.length === 0) {
        const finalText = assistantMessage.content ?? '';

        if (!finalText.trim()) {
          throw new AgentError(
            'EMPTY_RESPONSE',
            `Model returned an empty response after ${round + 1} rounds`,
          );
        }

        // Fast path: valid JSON — return immediately.
        if (isValidJson(finalText)) {
          this.logger.debug(
            `Investigation for ${request.transactionId} concluded after ${round + 1} round(s). ` +
            `Tools used: [${toolsExecuted.join(', ')}]`,
          );
          return { finalText, toolsExecuted };
        }

        // Slow path: model wrapped output in markdown fences or added prose.
        // Attempt one correction round before handing off to InvestigationService.
        this.logger.warn(
          `Non-JSON response for ${request.transactionId} after round ${round + 1}. ` +
          `Attempting JSON correction round.`,
        );

        const correctedText = await this.attemptJsonCorrection(
          messages,
          finalText,
          request.transactionId,
          round + 1,
          signal,
        );

        this.logger.debug(
          `Investigation for ${request.transactionId} concluded after correction. ` +
          `Tools used: [${toolsExecuted.join(', ')}]`,
        );

        return { finalText: correctedText, toolsExecuted };
      }

      // ── Process each tool call ────────────────────────────────────────────
      for (const call of toolCalls) {
        const toolName = call.function.name;

        this.logger.debug(`Executing tool "${toolName}" for ${request.transactionId}`);
        toolsExecuted.push(toolName);

        const result = await this.toolRegistry.execute(toolName, call.function.arguments);

        // Push tool result back so the model can reason about it next round.
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: [{ type: 'text', text: JSON.stringify(result) }],
        });
      }
    }

    // ── Round limit reached ───────────────────────────────────────────────────
    throw new AgentError(
      'ROUND_LIMIT',
      `Investigation for ${request.transactionId} reached the ${this.maxRounds}-round limit`,
    );
  }

  /**
   * Attempt a single JSON correction round when the model returned non-JSON.
   *
   * - Sends a correction user message with no tools so the model cannot
   *   trigger additional tool calls during this round.
   * - Counts as one round against maxRounds; if none remain, throws ROUND_LIMIT.
   * - If the corrected response is still not valid JSON, returns the raw text
   *   so InvestigationService can apply its own fence-stripping fallback.
   * - Respects the AbortSignal: throws TIMEOUT if already aborted.
   */
  private async attemptJsonCorrection(
    messages: IbmMessage[],
    previousText: string,
    transactionId: string,
    roundsUsed: number,
    signal: AbortSignal,
  ): Promise<string> {
    if (signal.aborted) {
      throw new AgentError('TIMEOUT', 'AbortSignal fired before correction round');
    }

    if (roundsUsed >= this.maxRounds) {
      throw new AgentError(
        'ROUND_LIMIT',
        `Investigation for ${transactionId} reached the ${this.maxRounds}-round limit before correction`,
      );
    }

    // Push the original (invalid) assistant message so history is coherent.
    // (It was already pushed by the main loop — no need to push again.)
    // Add a user correction request.
    const correctionMessage: IbmMessage = {
      role: 'user',
      content: [
        {
          type: 'text',
          text:
            'A sua resposta anterior não é um objeto JSON válido. ' +
            'Responda SOMENTE com o objeto JSON do relatório, começando com { e terminando com }. ' +
            'Não inclua ```json, ```, texto explicativo nem qualquer outro conteúdo fora do JSON.',
        },
      ],
    };

    messages.push(correctionMessage);

    this.logger.debug(`Correction round for ${transactionId} (round ${roundsUsed + 1}/${this.maxRounds})`);

    // Call with empty tools array — model MUST respond with text, not a tool call.
    const correctionResponse = await this.watsonx.chat(messages, [], signal);
    const correctedText = correctionResponse.content ?? '';

    if (!correctedText.trim()) {
      // Empty correction response — return the original text for IS to handle.
      this.logger.warn(`Empty correction response for ${transactionId}; returning original text`);
      return previousText;
    }

    if (!isValidJson(correctedText)) {
      this.logger.warn(`Correction still not valid JSON for ${transactionId}; returning corrected text for IS fallback`);
    }

    return correctedText;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build the user message that starts the investigation.
 *
 * Only transactionId is available here (InvestigationRequest contract).
 * The agent is instructed to use tools to gather all other information,
 * preventing client-supplied values from influencing the investigation.
 */
function buildUserMessage(request: InvestigationRequest): string {
  return (
    `Investigue a transação com ID: ${request.transactionId}\n\n` +
    `Você ainda não conhece os detalhes desta transação nem o histórico do associado. ` +
    `Comece chamando getTransactionDetails com o ID acima para obter o customerId e os dados da transação. ` +
    `Use o customerId retornado por essa ferramenta — nunca invente identificadores. ` +
    `Após coletar as evidências necessárias, finalize com um objeto JSON puro, sem markdown, sem texto adicional.`
  );
}

/**
 * Returns true if `text` parses as a JSON object or array.
 * Used to decide whether a correction round is needed.
 */
function isValidJson(text: string): boolean {
  try {
    const trimmed = text.trim();
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}
