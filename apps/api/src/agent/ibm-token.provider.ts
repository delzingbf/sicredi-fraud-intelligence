import { readFile } from 'node:fs/promises';
import type { ConfigService } from '@nestjs/config';
import { z } from 'zod';
import type { AppEnv } from '../config/app.config.js';
import { AgentError } from './agent.orchestrator.interface.js';

const credentialsSchema = z.object({ apikey: z.string().trim().min(1) });
const tokenSchema = z.object({
  access_token: z.string().min(1),
  expires_in: z.number().positive(),
});

/** Keeps IAM credentials in memory; never writes tokens to disk or logs secrets. */
export class IbmTokenProvider {
  private cached?: { token: string; expiresAt: number };
  // Separate callers keep their own AbortSignal; only completed tokens are shared.
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  async getToken(signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const path = this.config.get('IBM_API_KEY_FILE', { infer: true });
    if (!path) {
      const token = this.config.get('IBM_ACCESS_TOKEN', { infer: true });
      if (!token?.trim()) throw new AgentError('IBM_ERROR', 'IBM credentials are missing');
      return token;
    }
    if (this.cached && Date.now() < this.cached.expiresAt) return this.cached.token;

    try {
      const raw: unknown = JSON.parse(await readFile(path, { encoding: 'utf8', signal }));
      const parsed = credentialsSchema.safeParse(raw);
      if (!parsed.success) throw new Error('invalid credentials');
      const response = await fetch('https://iam.cloud.ibm.com/identity/token', {
        method: 'POST',
        signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
          apikey: parsed.data.apikey,
        }).toString(),
      });
      if (!response.ok) throw new AgentError('IBM_ERROR', 'IBM IAM authentication failed');
      const result = tokenSchema.safeParse(await response.json());
      if (!result.success) throw new Error('invalid token response');
      signal.throwIfAborted();
      this.cached = {
        token: result.data.access_token,
        expiresAt: Date.now() + Math.max(0, result.data.expires_in - 60) * 1000,
      };
      return this.cached.token;
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      // Do not include file contents, IAM response bodies or underlying exceptions.
      throw new AgentError('IBM_ERROR', 'Cannot obtain IBM token; check the API key JSON file and IAM access');
    }
  }
}
