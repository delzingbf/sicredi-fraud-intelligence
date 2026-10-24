import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WatsonxClient, type IbmMessage, type IbmToolDefinition } from './watsonx.client.js';
import { AgentError } from './agent.orchestrator.interface.js';
import { ConfigService } from '@nestjs/config';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const defaults: Record<string, unknown> = {
    IBM_CHAT_API_URL: 'https://us-south.ml.cloud.ibm.com/ml/v1/text/chat?version=2024-10-08',
    IBM_PROJECT_ID: 'test-project-id',
    IBM_MODEL_ID: 'ibm/granite-4-h-small',
    IBM_ACCESS_TOKEN: 'test-token',
    ...overrides,
  };
  return { get: (key: string) => defaults[key] } as unknown as ConfigService;
}

const MESSAGES: IbmMessage[] = [
  { role: 'system', content: [{ type: 'text', text: 'You are an agent.' }] },
  { role: 'user', content: [{ type: 'text', text: 'Investigate TX-001.' }] },
];

const TOOLS: IbmToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'getTxDetails',
      description: 'Get transaction details.',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  },
];

const OK_RESPONSE = {
  choices: [{ message: { role: 'assistant', content: '{"riskLevel":"LOW_RISK"}', tool_calls: undefined } }],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('WatsonxClient', () => {
  let client: WatsonxClient;

  beforeEach(() => {
    client = new WatsonxClient(makeConfig());
    vi.restoreAllMocks();
  });

  it('calls IBM with correct headers and body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(OK_RESPONSE),
    });
    vi.stubGlobal('fetch', fetchMock);

    await client.chat(MESSAGES, TOOLS, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toContain('us-south.ml.cloud.ibm.com');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string);
    expect(body.project_id).toBe('test-project-id');
    expect(body.model_id).toBe('ibm/granite-4-h-small');
    expect(body.temperature).toBe(0);
    expect(body.tool_choice_option).toBe('auto');
    expect(body.messages).toHaveLength(MESSAGES.length);
    expect(body.tools).toHaveLength(TOOLS.length);
  });

  it('returns the assistant message from choices[0]', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(OK_RESPONSE),
    }));

    const result = await client.chat(MESSAGES, TOOLS, new AbortController().signal);

    expect(result.role).toBe('assistant');
    expect(result.content).toBe('{"riskLevel":"LOW_RISK"}');
  });

  it('throws AgentError IBM_ERROR on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: 'Unauthorized' }),
    }));

    await expect(
      client.chat(MESSAGES, TOOLS, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'IBM_ERROR' });
  });

  it('throws AgentError IBM_ERROR on network failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network error')));

    await expect(
      client.chat(MESSAGES, TOOLS, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'IBM_ERROR' });
  });

  it('re-throws AbortError without wrapping', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abortError));

    await expect(
      client.chat(MESSAGES, TOOLS, new AbortController().signal),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('passes the AbortSignal to fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(OK_RESPONSE),
    });
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    await client.chat(MESSAGES, TOOLS, controller.signal);

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);
  });

  it('throws AgentError IBM_ERROR even when error body is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('not json')),
    }));

    const err = await client.chat(MESSAGES, TOOLS, new AbortController().signal).catch(e => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).code).toBe('IBM_ERROR');
    expect((err as AgentError).message).toContain('500');
  });
});
