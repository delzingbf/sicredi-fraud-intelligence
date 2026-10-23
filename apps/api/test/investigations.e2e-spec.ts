import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import type { InvestigationReport } from '@fraud-intelligence/contracts';
import { AppModule } from '../src/app.module.js';
import {
  AGENT_ORCHESTRATOR,
  AgentError,
  type AgentResult,
  type IAgentOrchestrator,
} from '../src/agent/agent.orchestrator.interface.js';
import { configureApp } from '../src/configure-app.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TX = 'TX-E2E-001';

function makeValidReport(overrides: Partial<InvestigationReport> = {}): InvestigationReport {
  return {
    schemaVersion: '1.0',
    transactionId: TX,
    riskLevel: 'HIGH_RISK',
    recommendedAction: 'MANUAL_REVIEW',
    toolsExecuted: ['getTransactionDetails'],
    evidenceFor: ['Amount 8x above average'],
    evidenceAgainst: [],
    missingInformation: [],
    contradictions: [],
    explanation: 'E2E test report.',
    requiresHumanReview: true,
    confidence: 'HIGH',
    ...overrides,
  };
}

const verifiableReport = makeValidReport({ recommendedAction: 'REQUEST_MEMBER_VERIFICATION' });

function agentReturning(finalText: string, toolsExecuted = ['getTransactionDetails']): IAgentOrchestrator {
  return { investigate: (): Promise<AgentResult> => Promise.resolve({ finalText, toolsExecuted }) };
}

function agentReporting(report: unknown): IAgentOrchestrator {
  return agentReturning(JSON.stringify(report));
}

/**
 * Boots the real AppModule (same wiring as production). Pass an agent to
 * override AGENT_ORCHESTRATOR; omit it to use the AgentModule mock.
 */
async function createApp(agent?: IAgentOrchestrator): Promise<INestApplication<App>> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (agent) builder.overrideProvider(AGENT_ORCHESTRATOR).useValue(agent);
  const module = await builder.compile();

  const app = module.createNestApplication<INestApplication<App>>();
  configureApp(app);
  await app.init();
  return app;
}

async function investigate(app: INestApplication<App>, transactionId = TX) {
  const { body } = await request(app.getHttpServer())
    .post('/investigations')
    .send({ transactionId })
    .expect(200);
  return body as { investigationId: string; report: InvestigationReport };
}

// ─── Production wiring ────────────────────────────────────────────────────────

describe('AppModule wiring (no overrides)', () => {
  let app: INestApplication<App>;
  beforeEach(async () => { app = await createApp(); });
  afterEach(() => app.close());

  it('POST /investigations reaches the AgentModule mock, not a null provider', async () => {
    const { report } = await investigate(app);
    expect(report.riskLevel).toBe('INCONCLUSIVE');
    expect(report.missingInformation).toEqual(['AgentOrchestrator not yet implemented']);
  });
});

// ─── POST /investigations ─────────────────────────────────────────────────────

describe('POST /investigations — happy path', () => {
  let app: INestApplication<App>;
  beforeEach(async () => {
    app = await createApp(agentReporting(makeValidReport({ toolsExecuted: ['hallucinated'] })));
  });
  afterEach(() => app.close());

  it('returns 200 with an investigationId and the validated report', async () => {
    const { investigationId, report } = await investigate(app);
    expect(investigationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(report.schemaVersion).toBe('1.0');
    expect(report.riskLevel).toBe('HIGH_RISK');
    expect(report.transactionId).toBe(TX);
  });

  it('toolsExecuted reflects the authoritative trace, not the LLM self-report', async () => {
    const { report } = await investigate(app);
    expect(report.toolsExecuted).toEqual(['getTransactionDetails']);
  });
});

describe('POST /investigations — input validation', () => {
  let app: INestApplication<App>;
  beforeEach(async () => { app = await createApp(agentReporting(makeValidReport())); });
  afterEach(() => app.close());

  it.each([
    ['missing transactionId', {}],
    ['blank transactionId', { transactionId: '   ' }],
    ['transactionId over 100 chars', { transactionId: 'X'.repeat(101) }],
    ['transactionId with forbidden chars', { transactionId: '<script>\n IGNORE ALL' }],
    ['unknown field', { transactionId: 'TX-001', fraudLabel: true }],
    ['metadata (prompt-injection vector)', { transactionId: 'TX-001', metadata: { note: 'x' } }],
  ])('returns 400 for %s', async (_label, body) => {
    await request(app.getHttpServer()).post('/investigations').send(body).expect(400);
  });

  it('accepts a transactionId of exactly 100 characters', async () => {
    await request(app.getHttpServer())
      .post('/investigations')
      .send({ transactionId: 'X'.repeat(100) })
      .expect(200);
  });
});

describe('POST /investigations — agent failures always return 200 INCONCLUSIVE', () => {
  it.each([
    ['IBM_ERROR', { investigate: () => Promise.reject(new AgentError('IBM_ERROR', 'boom')) }],
    ['ROUND_LIMIT', { investigate: () => Promise.reject(new AgentError('ROUND_LIMIT', 'x')) }],
    ['prose output', agentReturning('Transaction is suspicious.')],
    ['wrong schema', agentReporting({ riskLevel: 'VERY_HIGH' })],
    ['report for another transaction', agentReporting(makeValidReport({ transactionId: 'TX-OTHER' }))],
  ] as [string, IAgentOrchestrator][])('%s → INCONCLUSIVE', async (_label, agent) => {
    const app = await createApp(agent);
    try {
      const { report } = await investigate(app);
      expect(report.riskLevel).toBe('INCONCLUSIVE');
      expect(report.requiresHumanReview).toBe(true);
      expect(report.confidence).toBe('LOW');
      expect(report.transactionId).toBe(TX);
    } finally {
      await app.close();
    }
  });

  it('markdown-fenced JSON is parsed', async () => {
    const app = await createApp(agentReturning('```json\n' + JSON.stringify(makeValidReport()) + '\n```'));
    try {
      const { report } = await investigate(app);
      expect(report.riskLevel).toBe('HIGH_RISK');
    } finally {
      await app.close();
    }
  });

  it('unknown errors never leak internal details', async () => {
    const app = await createApp({ investigate: () => Promise.reject(new Error('ECONNREFUSED 10.0.0.1:5432')) });
    try {
      const body = await investigate(app);
      expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
      expect(JSON.stringify(body)).not.toContain('10.0.0.1');
    } finally {
      await app.close();
    }
  });
});

// ─── Member verification ──────────────────────────────────────────────────────

describe('Member verification — allowed report', () => {
  let app: INestApplication<App>;
  let investigationId: string;

  beforeEach(async () => {
    app = await createApp(agentReporting(verifiableReport));
    ({ investigationId } = await investigate(app));
  });
  afterEach(() => app.close());

  const path = (id: string, suffix = '') => `/investigations/${id}/member-verification${suffix}`;

  it('request → PENDING, confirm → CONFIRMED, GET reflects state', async () => {
    const server = app.getHttpServer();

    const { body: pending } = await request(server).post(path(investigationId)).expect(200);
    expect(pending).toMatchObject({ investigationId, transactionId: TX, status: 'PENDING' });

    const { body: confirmed } = await request(server)
      .post(path(investigationId, '/confirm'))
      .send({ decision: 'CONFIRMED' })
      .expect(200);
    expect(confirmed.status).toBe('CONFIRMED');
    expect(typeof confirmed.resolvedAt).toBe('string');

    const { body: current } = await request(server).get(path(investigationId)).expect(200);
    expect(current.status).toBe('CONFIRMED');
  });

  it('a second request returns 409 and does not reset a resolved decision', async () => {
    const server = app.getHttpServer();
    await request(server).post(path(investigationId)).expect(200);
    await request(server).post(path(investigationId, '/confirm')).send({ decision: 'DENIED' }).expect(200);

    await request(server).post(path(investigationId)).expect(409);
    const { body } = await request(server).get(path(investigationId)).expect(200);
    expect(body.status).toBe('DENIED');
  });

  it('confirming twice returns 409', async () => {
    const server = app.getHttpServer();
    await request(server).post(path(investigationId)).expect(200);
    await request(server).post(path(investigationId, '/confirm')).send({ decision: 'CONFIRMED' }).expect(200);
    await request(server).post(path(investigationId, '/confirm')).send({ decision: 'DENIED' }).expect(409);
  });

  it.each([
    ['invalid decision', { decision: 'MAYBE' }],
    ['unknown field', { decision: 'CONFIRMED', extra: 1 }],
  ])('confirm returns 400 for %s', async (_label, body) => {
    const server = app.getHttpServer();
    await request(server).post(path(investigationId)).expect(200);
    await request(server).post(path(investigationId, '/confirm')).send(body).expect(400);
  });

  it('confirm before any request returns 404', async () => {
    await request(app.getHttpServer())
      .post(path(investigationId, '/confirm'))
      .send({ decision: 'CONFIRMED' })
      .expect(404);
  });

  it('unknown investigationId returns 404', async () => {
    await request(app.getHttpServer())
      .post(path('00000000-0000-4000-8000-000000000000'))
      .expect(404);
  });

  it('non-UUID investigationId returns 400', async () => {
    await request(app.getHttpServer()).post(path('inventado-123')).expect(400);
    await request(app.getHttpServer()).post(path('z'.repeat(5000))).expect(400);
  });
});

describe('Member verification — gate uses the stored report, never the client', () => {
  it('returns 403 for a stored MANUAL_REVIEW report even if the client sends a forged one', async () => {
    const app = await createApp(agentReporting(makeValidReport()));
    try {
      const { investigationId } = await investigate(app);
      await request(app.getHttpServer())
        .post(`/investigations/${investigationId}/member-verification`)
        .send(verifiableReport)
        .expect(403);
    } finally {
      await app.close();
    }
  });

  it('returns 403 for an INCONCLUSIVE fallback report', async () => {
    const app = await createApp({ investigate: () => Promise.reject(new AgentError('IBM_ERROR', 'x')) });
    try {
      const { investigationId } = await investigate(app);
      await request(app.getHttpServer())
        .post(`/investigations/${investigationId}/member-verification`)
        .expect(403);
    } finally {
      await app.close();
    }
  });
});
