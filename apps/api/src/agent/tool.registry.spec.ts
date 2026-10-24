import { describe, it, expect, beforeEach } from 'vitest';
import { ToolRegistry, parseArguments } from './tool.registry.js';

// ─── parseArguments ───────────────────────────────────────────────────────────

describe('parseArguments', () => {
  it('returns a plain object unchanged', () => {
    expect(parseArguments({ id: 'TX-001' })).toEqual({ id: 'TX-001' });
  });

  it('parses a JSON string once', () => {
    expect(parseArguments('{"id":"TX-001"}')).toEqual({ id: 'TX-001' });
  });

  it('parses a double-serialised JSON string (Granite quirk)', () => {
    const doubleEncoded = JSON.stringify(JSON.stringify({ id: 'TX-001' }));
    expect(parseArguments(doubleEncoded)).toEqual({ id: 'TX-001' });
  });

  it('throws on null', () => {
    expect(() => parseArguments(null)).toThrow();
  });

  it('throws on an array', () => {
    expect(() => parseArguments([1, 2, 3])).toThrow();
  });

  it('throws on a bare string (not JSON)', () => {
    expect(() => parseArguments('not-json')).toThrow();
  });
});

// ─── ToolRegistry ─────────────────────────────────────────────────────────────

function makeMockTool(returnValue = { status: 'success' as const, data: 'ok', metadata: { tool: 'mock', dataSource: 'test', missingFields: [] } }) {
  return {
    definition: {
      type: 'function' as const,
      function: {
        name: 'mockTool',
        description: 'A test tool.',
        parameters: {
          type: 'object' as const,
          properties: { id: { type: 'string' } },
          required: ['id'],
        },
      },
    },
    implementation: () => returnValue,
  };
}

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('starts empty', () => {
    expect(registry.size).toBe(0);
    expect(registry.getDefinitions()).toEqual([]);
  });

  it('registers a tool and returns its definition', () => {
    registry.register('mockTool', makeMockTool());
    expect(registry.size).toBe(1);
    expect(registry.getDefinitions()[0].function.name).toBe('mockTool');
  });

  it('overwrites a previously registered tool', () => {
    registry.register('mockTool', makeMockTool());
    const updated = makeMockTool({ status: 'error', data: null, metadata: { tool: 'mock', dataSource: 'test', missingFields: [] } });
    registry.register('mockTool', updated);
    expect(registry.size).toBe(1);
  });

  it('executes a registered tool and returns its result', async () => {
    registry.register('mockTool', makeMockTool());
    const result = await registry.execute('mockTool', { id: 'TX-001' });
    expect(result.status).toBe('success');
  });

  it('returns status error for an unknown tool (whitelist)', async () => {
    const result = await registry.execute('unknownTool', {});
    expect(result.status).toBe('error');
    expect(result.message).toContain('"unknownTool" is not registered');
  });

  it('returns status error on invalid arguments', async () => {
    registry.register('mockTool', makeMockTool());
    // null is not a valid argument object
    const result = await registry.execute('mockTool', null);
    expect(result.status).toBe('error');
    expect(result.message).toContain('Invalid arguments');
  });

  it('catches unexpected throws from the implementation and returns error', async () => {
    registry.register('crashTool', {
      ...makeMockTool(),
      implementation: () => { throw new Error('kaboom'); },
    });
    const result = await registry.execute('crashTool', { id: '1' });
    expect(result.status).toBe('error');
    expect(result.message).toContain('"crashTool"');
  });

  it('getDefinitions returns all registered definitions', () => {
    registry.register('tool1', makeMockTool());
    registry.register('tool2', makeMockTool());
    const defs = registry.getDefinitions();
    expect(defs).toHaveLength(2);
  });

  it('passes parsed arguments to the implementation', async () => {
    let capturedArgs: Record<string, unknown> = {};
    registry.register('capturer', {
      ...makeMockTool(),
      implementation: (args) => {
        capturedArgs = args;
        return { status: 'success', data: null, metadata: { tool: 'capturer', dataSource: 'test', missingFields: [] } };
      },
    });
    await registry.execute('capturer', '{"id":"TX-001"}');
    expect(capturedArgs['id']).toBe('TX-001');
  });
});
