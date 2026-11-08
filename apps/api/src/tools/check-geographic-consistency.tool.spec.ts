import { describe, it, expect } from 'vitest';
import { ToolRegistry } from '../agent/tool.registry.js';
import { CheckGeographicConsistencyTool } from './check-geographic-consistency.tool.js';

// ── Setup ─────────────────────────────────────────────────────────────────────

function setup() {
  const registry = new ToolRegistry();
  const tool = new CheckGeographicConsistencyTool(registry);
  tool.onModuleInit();

  const execute = (args: Record<string, unknown>) =>
    registry.execute('checkGeographicConsistency', args);

  return { execute };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CheckGeographicConsistencyTool', () => {
  it('always returns unavailable for any valid args', async () => {
    const { execute } = setup();

    const result = await execute({ transactionId: 'EVT_SYN_000000001' });

    expect(result.status).toBe('unavailable');
  });

  it('message mentions fill rate ~24%', async () => {
    const { execute } = setup();

    const result = await execute({ transactionId: 'EVT_SYN_000000001' });

    expect(result.message).toContain('~24%');
  });

  it('metadata.dataSource is "stub"', async () => {
    const { execute } = setup();

    const result = await execute({ transactionId: 'EVT_SYN_000000001' });

    expect(result.metadata.dataSource).toBe('stub');
  });

  it('missingFields contains acceptor_latitude and terminal_latitude', async () => {
    const { execute } = setup();

    const result = await execute({ transactionId: 'EVT_SYN_000000001' });

    expect(result.metadata.missingFields).toContain('acceptor_latitude');
    expect(result.metadata.missingFields).toContain('terminal_latitude');
  });
});
