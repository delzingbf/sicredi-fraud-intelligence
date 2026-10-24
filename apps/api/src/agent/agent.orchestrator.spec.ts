import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentOrchestrator } from './agent.orchestrator.js';
import { AgentError } from './agent.orchestrator.interface.js';
import { ToolRegistry } from './tool.registry.js';
import { WatsonxClient, type IbmResponseMessage } from './watsonx.client.js';
import { ConfigService } from '@nestjs/config';
import type { ToolResult } from '@fraud-intelligence/contracts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(maxRounds = 4): ConfigService {
  return {
    get: (key: string) => {
      if (key === 'MAX_INVESTIGATION_ROUNDS') return maxRounds;
      return undefined;
    },
  } as unknown as ConfigService;
}

/** A valid InvestigationReport JSON string the model would return. */
function validReportJson(transactionId: string): string {
  return JSON.stringify({
    schemaVersion: '1.0',
    transactionId,
    riskLevel: 'LOW_RISK',
    recommendedAction: 'PROCEED',
    toolsExecuted: [],
    evidenceFor: [],
    evidenceAgainst: [],
    missingInformation: [],
    contradictions: [],
    explanation: 'No anomalies detected.',
    requiresHumanReview: false,
    confidence: 'HIGH',
  });
}

/** A ToolResult the mock tools return. */
const TOOL_RESULT: ToolResult = {
  status: 'success',
  data: { info: 'mock data' },
  metadata: { tool: 'mockTool', dataSource: 'mock', missingFields: [] },
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AgentOrchestrator', () => {
  let registry: ToolRegistry;
  let watsonx: WatsonxClient;
  let orchestrator: AgentOrchestrator;

  beforeEach(() => {
    registry = new ToolRegistry();
    watsonx = { chat: vi.fn() } as unknown as WatsonxClient;
    orchestrator = new AgentOrchestrator(watsonx, registry, makeConfig());
    vi.restoreAllMocks();
  });

  it('returns finalText and empty toolsExecuted when model concludes without calling any tool', async () => {
    const expectedJson = validReportJson('TX-001');
    vi.mocked(watsonx.chat).mockResolvedValueOnce({
      role: 'assistant',
      content: expectedJson,
    } as IbmResponseMessage);

    const result = await orchestrator.investigate(
      { transactionId: 'TX-001' },
      new AbortController().signal,
    );

    expect(result.finalText).toBe(expectedJson);
    expect(result.toolsExecuted).toEqual([]);
  });

  it('calls a registered tool when model requests it, then returns final answer', async () => {
    const toolCall = {
      id: 'call-1',
      type: 'function' as const,
      function: { name: 'mockTool', arguments: { transactionId: 'TX-002' } },
    };

    registry.register('mockTool', {
      definition: {
        type: 'function',
        function: {
          name: 'mockTool',
          description: 'A test tool',
          parameters: { type: 'object', properties: {}, required: [] },
        },
      },
      implementation: () => TOOL_RESULT,
    });

    vi.mocked(watsonx.chat)
      // Round 1: model requests tool
      .mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [toolCall] } as IbmResponseMessage)
      // Round 2: model produces final answer
      .mockResolvedValueOnce({ role: 'assistant', content: validReportJson('TX-002') } as IbmResponseMessage);

    const result = await orchestrator.investigate(
      { transactionId: 'TX-002' },
      new AbortController().signal,
    );

    expect(watsonx.chat).toHaveBeenCalledTimes(2);
    expect(result.toolsExecuted).toEqual(['mockTool']);
    expect(result.finalText).toContain('TX-002');
  });

  it('records all tools when model calls multiple tools across rounds', async () => {
    const makeCall = (name: string, id: string) => ({
      id,
      type: 'function' as const,
      function: { name, arguments: {} },
    });

    for (const name of ['toolA', 'toolB', 'toolC']) {
      registry.register(name, {
        definition: { type: 'function', function: { name, description: '', parameters: { type: 'object', properties: {} } } },
        implementation: () => TOOL_RESULT,
      });
    }

    vi.mocked(watsonx.chat)
      .mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [makeCall('toolA', 'c1'), makeCall('toolB', 'c2')] } as IbmResponseMessage)
      .mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [makeCall('toolC', 'c3')] } as IbmResponseMessage)
      .mockResolvedValueOnce({ role: 'assistant', content: validReportJson('TX-003') } as IbmResponseMessage);

    const result = await orchestrator.investigate({ transactionId: 'TX-003' }, new AbortController().signal);
    expect(result.toolsExecuted).toEqual(['toolA', 'toolB', 'toolC']);
  });

  it('throws AgentError ROUND_LIMIT when the model never stops calling tools', async () => {
    const toolCall = {
      id: 'call-x',
      type: 'function' as const,
      function: { name: 'mockTool', arguments: {} },
    };
    registry.register('mockTool', {
      definition: { type: 'function', function: { name: 'mockTool', description: '', parameters: { type: 'object', properties: {} } } },
      implementation: () => TOOL_RESULT,
    });

    // Always return tool calls — never concludes.
    vi.mocked(watsonx.chat).mockResolvedValue({
      role: 'assistant',
      content: null,
      tool_calls: [toolCall],
    } as IbmResponseMessage);

    await expect(
      orchestrator.investigate({ transactionId: 'TX-004' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ROUND_LIMIT' });

    // Should have called IBM exactly maxRounds times.
    expect(watsonx.chat).toHaveBeenCalledTimes(4);
  });

  it('throws AgentError EMPTY_RESPONSE when the model returns empty content', async () => {
    vi.mocked(watsonx.chat).mockResolvedValueOnce({
      role: 'assistant',
      content: '',
    } as IbmResponseMessage);

    await expect(
      orchestrator.investigate({ transactionId: 'TX-005' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'EMPTY_RESPONSE' });
  });

  it('stops before calling IBM when AbortSignal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      orchestrator.investigate({ transactionId: 'TX-006' }, controller.signal),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    expect(watsonx.chat).not.toHaveBeenCalled();
  });

  it('propagates AgentError IBM_ERROR from WatsonxClient', async () => {
    vi.mocked(watsonx.chat).mockRejectedValueOnce(
      new AgentError('IBM_ERROR', 'HTTP 401'),
    );

    await expect(
      orchestrator.investigate({ transactionId: 'TX-007' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'IBM_ERROR' });
  });

  it('includes the transactionId in the user message', async () => {
    const expectedJson = validReportJson('TX-UNIQUE');
    vi.mocked(watsonx.chat).mockResolvedValueOnce({
      role: 'assistant',
      content: expectedJson,
    } as IbmResponseMessage);

    await orchestrator.investigate({ transactionId: 'TX-UNIQUE' }, new AbortController().signal);

    const firstCallMessages = vi.mocked(watsonx.chat).mock.calls[0][0];
    const userMessage = firstCallMessages.find(m => m.role === 'user');
    expect(JSON.stringify(userMessage)).toContain('TX-UNIQUE');
  });

  it('sends tool definitions to every WatsonxClient.chat() call', async () => {
    registry.register('someTool', {
      definition: { type: 'function', function: { name: 'someTool', description: '', parameters: { type: 'object', properties: {} } } },
      implementation: () => TOOL_RESULT,
    });

    const toolCall = { id: 'c', type: 'function' as const, function: { name: 'someTool', arguments: {} } };
    vi.mocked(watsonx.chat)
      .mockResolvedValueOnce({ role: 'assistant', content: null, tool_calls: [toolCall] } as IbmResponseMessage)
      .mockResolvedValueOnce({ role: 'assistant', content: validReportJson('TX-008') } as IbmResponseMessage);

    await orchestrator.investigate({ transactionId: 'TX-008' }, new AbortController().signal);

    for (const call of vi.mocked(watsonx.chat).mock.calls) {
      const toolDefs = call[1];
      expect(toolDefs.some(d => d.function.name === 'someTool')).toBe(true);
    }
  });

  // ── JSON correction tests ────────────────────────────────────────────────────

  it('returns valid JSON directly without triggering a correction round', async () => {
    const expectedJson = validReportJson('TX-DIRECT');
    vi.mocked(watsonx.chat).mockResolvedValueOnce({
      role: 'assistant',
      content: expectedJson,
    } as IbmResponseMessage);

    const result = await orchestrator.investigate(
      { transactionId: 'TX-DIRECT' },
      new AbortController().signal,
    );

    // No correction round — IBM called exactly once.
    expect(watsonx.chat).toHaveBeenCalledTimes(1);
    expect(result.finalText).toBe(expectedJson);
  });

  it('performs one correction round when model wraps JSON in markdown fences', async () => {
    const rawJson = validReportJson('TX-FENCE');
    const fencedResponse = `\`\`\`json\n${rawJson}\n\`\`\``;
    const correctedJson = rawJson; // correction round returns clean JSON

    vi.mocked(watsonx.chat)
      // Round 1: model returns fenced markdown
      .mockResolvedValueOnce({ role: 'assistant', content: fencedResponse } as IbmResponseMessage)
      // Correction round: returns clean JSON
      .mockResolvedValueOnce({ role: 'assistant', content: correctedJson } as IbmResponseMessage);

    const result = await orchestrator.investigate(
      { transactionId: 'TX-FENCE' },
      new AbortController().signal,
    );

    expect(watsonx.chat).toHaveBeenCalledTimes(2);
    expect(result.finalText).toBe(correctedJson);
    // Correction call must pass empty tools array.
    const correctionCall = vi.mocked(watsonx.chat).mock.calls[1];
    expect(correctionCall[1]).toEqual([]);
  });

  it('returns the (still-invalid) corrected text when both attempts fail — lets InvestigationService handle it', async () => {
    const notJson = 'Desculpe, não posso gerar um JSON agora.';
    const alsoNotJson = 'Ainda não é JSON.';

    vi.mocked(watsonx.chat)
      // Round 1: non-JSON
      .mockResolvedValueOnce({ role: 'assistant', content: notJson } as IbmResponseMessage)
      // Correction round: also non-JSON
      .mockResolvedValueOnce({ role: 'assistant', content: alsoNotJson } as IbmResponseMessage);

    const result = await orchestrator.investigate(
      { transactionId: 'TX-FAIL' },
      new AbortController().signal,
    );

    // Should NOT throw — return the last text so IS can decide.
    expect(result.finalText).toBe(alsoNotJson);
    expect(watsonx.chat).toHaveBeenCalledTimes(2);
  });

  it('throws ROUND_LIMIT when no rounds remain for the correction attempt', async () => {
    // maxRounds=1 → the single main round consumes the budget; no room for correction.
    const tightOrchestrator = new AgentOrchestrator(watsonx, registry, makeConfig(1));
    const notJson = 'não é json';

    vi.mocked(watsonx.chat).mockResolvedValueOnce({
      role: 'assistant',
      content: notJson,
    } as IbmResponseMessage);

    await expect(
      tightOrchestrator.investigate({ transactionId: 'TX-TIGHT' }, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'ROUND_LIMIT' });

    // Only 1 IBM call — the correction round was blocked.
    expect(watsonx.chat).toHaveBeenCalledTimes(1);
  });

  it('throws TIMEOUT when AbortSignal fires before the correction round starts', async () => {
    const controller = new AbortController();
    const notJson = 'não é json';

    // Round 1 mock: returns non-JSON AND aborts the signal as a side-effect,
    // so that when attemptJsonCorrection checks signal.aborted it is already true.
    vi.mocked(watsonx.chat).mockImplementationOnce(() => {
      controller.abort();
      return Promise.resolve({ role: 'assistant', content: notJson } as IbmResponseMessage);
    });

    await expect(
      orchestrator.investigate({ transactionId: 'TX-ABORT-CORR' }, controller.signal),
    ).rejects.toMatchObject({ code: 'TIMEOUT' });

    // Only the main round call was made — correction was blocked by the abort check.
    expect(watsonx.chat).toHaveBeenCalledTimes(1);
  });
});
