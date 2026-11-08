import { afterEach, describe, it, expect, vi } from 'vitest';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { IbmTokenProvider } from './ibm-token.provider.js';
vi.mock('node:fs/promises', () => ({ readFile: vi.fn() }));
const signal = () => new AbortController().signal;
function provider(values: Record<string, string>) {
  return new IbmTokenProvider({ get: (key: string) => values[key] } as unknown as ConfigService);
}
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('IAM credentials', () => {
  it('uses a manual token without accessing IAM', async () => {
    expect(await provider({ IBM_ACCESS_TOKEN: 'manual' }).getToken(signal())).toBe('manual');
    expect(readFile).not.toHaveBeenCalled();
  });
  it('caches the generated token and renews before expiry', async () => {
    vi.useFakeTimers();
    vi.mocked(readFile).mockResolvedValue('{"apikey":"test-key"}');
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ access_token: 'generated', expires_in: 3600 }) });
    vi.stubGlobal('fetch', fetcher);
    const tokens = provider({ IBM_API_KEY_FILE: '/example.json', IBM_ACCESS_TOKEN: 'old' });
    expect(await tokens.getToken(signal())).toBe('generated');
    await tokens.getToken(signal());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new URLSearchParams(fetcher.mock.calls[0][1].body).get('apikey')).toBe('test-key');
    vi.advanceTimersByTime(3540_000);
    await tokens.getToken(signal());
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('sanitizes file errors', async () => {
    vi.mocked(readFile).mockResolvedValue('secret-invalid-json');
    await expect(provider({ IBM_API_KEY_FILE: '/file' }).getToken(signal())).rejects.toThrow('Cannot obtain IBM token');
  });
  it('does not cache failed IAM authentication', async () => {
    vi.mocked(readFile).mockResolvedValue('{"apikey":"test-key"}');
    const fetcher = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetcher);
    const tokens = provider({ IBM_API_KEY_FILE: '/file' });
    for (let i = 0; i < 2; i++) await expect(tokens.getToken(signal())).rejects.toThrow('Cannot obtain IBM token');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('respects cancellation before loading credentials', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(provider({ IBM_API_KEY_FILE: '/file' }).getToken(controller.signal)).rejects.toBeDefined();
    expect(readFile).not.toHaveBeenCalled();
  });
});
