import { describe, it, expect, vi } from 'vitest';
import { dispatchMcpRequest } from '../src/domain/mcp-dispatch';
import type { McpContext } from '../src/types/mcp-context';

const ENDPOINT = 'http://127.0.0.1:27124/mcp';

function createMockContext(overrides: Partial<McpContext> = {}): McpContext {
  return {
    ready: true,
    embedReady: true,
    statusState: 'idle',
    version: '3.9.33',
    logger: { warn: vi.fn() },

    readNote: vi.fn(async (path: string) => {
      if (path === 'Note.md') return '# Note\n\nHello world';
      if (path === 'Folder/Other.md') return '# Other\n\nSecond note';
      return null;
    }),

    noteExists: vi.fn((path: string) => ['Note.md', 'Folder/Other.md'].includes(path)),

    embedQuery: vi.fn(async () => [1, 0, 0]),

    searchNearest: vi.fn(async () => [
      {
        path: 'Folder/Note.md',
        score: 0.92,
        blockKey: 'Folder/Note.md#Heading',
        headings: ['Heading'],
        preview: 'Relevant block text',
      },
    ]),

    getConnections: vi.fn(async () => [
      {
        path: 'Related.md',
        score: 0.88,
        blockKey: 'Related.md#Section',
        headings: ['Section'],
        preview: 'Related text',
      },
    ]),

    getModelInfo: () => ({ adapter: 'upstage', modelKey: 'embedding-passage', dims: 4096 }),
    getStats: () => ({ sourceCount: 2, embeddedSourceCount: 2, blockCount: 4, embeddedBlockCount: 4 }),

    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Protocol methods
// ---------------------------------------------------------------------------

describe('protocol: initialize', () => {
  it('returns protocol version and server info', async () => {
    const response = await dispatchMcpRequest(
      createMockContext(),
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      ENDPOINT,
    );

    expect(response?.result).toEqual({
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'open-connections', version: '3.9.33' },
      capabilities: { tools: {} },
    });
  });
});

describe('protocol: tools/list', () => {
  it('returns all 5 tool definitions', async () => {
    const response = await dispatchMcpRequest(
      createMockContext(),
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      ENDPOINT,
    );

    const tools = (response?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
    expect(tools).toEqual(['query', 'connections', 'get', 'multi_get', 'status']);
  });
});

describe('protocol: ping', () => {
  it('returns empty result', async () => {
    const response = await dispatchMcpRequest(
      createMockContext(),
      { jsonrpc: '2.0', id: 3, method: 'ping' },
      ENDPOINT,
    );

    expect(response?.result).toEqual({});
  });
});

describe('protocol: notifications/initialized', () => {
  it('returns null (fire-and-forget notification)', async () => {
    const response = await dispatchMcpRequest(
      createMockContext(),
      { jsonrpc: '2.0', id: null, method: 'notifications/initialized' },
      ENDPOINT,
    );

    expect(response).toBeNull();
  });
});

describe('protocol: unknown method', () => {
  it('returns -32601 method-not-found error', async () => {
    const response = await dispatchMcpRequest(
      createMockContext(),
      { jsonrpc: '2.0', id: 99, method: 'nonexistent/method' },
      ENDPOINT,
    );

    expect(response?.error).toMatchObject({ code: -32601 });
  });
});

// ---------------------------------------------------------------------------
// query tool
// ---------------------------------------------------------------------------

describe('tool: query', () => {
  it('calls embedQuery and searchNearest, returns matches', async () => {
    const ctx = createMockContext();
    const response = await dispatchMcpRequest(
      ctx,
      { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'query', arguments: { query: 'hello world' } } },
      ENDPOINT,
    );

    expect(ctx.embedQuery).toHaveBeenCalledWith('hello world');
    expect(ctx.searchNearest).toHaveBeenCalled();

    const result = response?.result as { structuredContent: { matches: Array<Record<string, unknown>> } };
    expect(result.structuredContent.matches).toEqual([
      expect.objectContaining({ path: 'Folder/Note.md', block_key: 'Folder/Note.md#Heading' }),
    ]);
  });

  it('passes scope=blocks through to searchNearest', async () => {
    const ctx = createMockContext();
    const response = await dispatchMcpRequest(
      ctx,
      {
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: { name: 'query', arguments: { query: 'test query', scope: 'blocks' } },
      },
      ENDPOINT,
    );

    expect(ctx.searchNearest).toHaveBeenCalled();
    const result = response?.result as { structuredContent: { scope: string } };
    expect(result.structuredContent.scope).toBe('blocks');
  });

  it('returns error when ctx.ready is false', async () => {
    const ctx = createMockContext({ ready: false });
    const response = await dispatchMcpRequest(
      ctx,
      { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'query', arguments: { query: 'test' } } },
      ENDPOINT,
    );

    const result = response?.result as { isError: boolean; structuredContent: Record<string, unknown> };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toBe('plugin_not_ready');
  });

  it('returns embed_model_unavailable error when embedReady is false', async () => {
    const ctx = createMockContext({ embedReady: false });
    const response = await dispatchMcpRequest(
      ctx,
      { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'query', arguments: { query: 'test' } } },
      ENDPOINT,
    );

    const result = response?.result as { isError: boolean; structuredContent: Record<string, unknown> };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toBe('embed_model_unavailable');
  });
});

// ---------------------------------------------------------------------------
// connections tool
// ---------------------------------------------------------------------------

describe('tool: connections', () => {
  it('calls getConnections and returns matches', async () => {
    const ctx = createMockContext();
    const response = await dispatchMcpRequest(
      ctx,
      { jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'connections', arguments: { path: 'Note.md' } } },
      ENDPOINT,
    );

    expect(ctx.getConnections).toHaveBeenCalledWith('Note.md', expect.any(Number));

    const result = response?.result as { structuredContent: { matches: Array<Record<string, unknown>> } };
    expect(result.structuredContent.matches).toEqual([
      expect.objectContaining({ path: 'Related.md', block_key: 'Related.md#Section' }),
    ]);
  });

  it('returns error when ctx.ready is false', async () => {
    const ctx = createMockContext({ ready: false });
    const response = await dispatchMcpRequest(
      ctx,
      { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'connections', arguments: { path: 'Note.md' } } },
      ENDPOINT,
    );

    const result = response?.result as { isError: boolean; structuredContent: Record<string, unknown> };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toBe('plugin_not_ready');
  });
});

// ---------------------------------------------------------------------------
// get tool
// ---------------------------------------------------------------------------

describe('tool: get', () => {
  it('calls readNote and returns content', async () => {
    const ctx = createMockContext();
    const response = await dispatchMcpRequest(
      ctx,
      { jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'get', arguments: { path: 'Note.md' } } },
      ENDPOINT,
    );

    expect(ctx.readNote).toHaveBeenCalledWith('Note.md');

    const result = response?.result as { structuredContent: { content: string } };
    expect(result.structuredContent.content).toContain('Hello world');
  });

  it('returns note_not_found error for missing note', async () => {
    const ctx = createMockContext();
    const response = await dispatchMcpRequest(
      ctx,
      { jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'get', arguments: { path: 'Missing.md' } } },
      ENDPOINT,
    );

    const result = response?.result as { isError: boolean; structuredContent: Record<string, unknown> };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toBe('note_not_found');
  });
});

// ---------------------------------------------------------------------------
// multi_get tool
// ---------------------------------------------------------------------------

describe('tool: multi_get', () => {
  it('calls readNote for each path and returns all items', async () => {
    const ctx = createMockContext();
    const response = await dispatchMcpRequest(
      ctx,
      {
        jsonrpc: '2.0',
        id: 40,
        method: 'tools/call',
        params: { name: 'multi_get', arguments: { paths: ['Note.md', 'Folder/Other.md'] } },
      },
      ENDPOINT,
    );

    expect(ctx.readNote).toHaveBeenCalledTimes(2);

    const result = response?.result as { structuredContent: { items: Array<Record<string, unknown>> } };
    expect(result.structuredContent.items).toEqual([
      expect.objectContaining({ ok: true, path: 'Note.md', content: expect.stringContaining('Hello world') }),
      expect.objectContaining({ ok: true, path: 'Folder/Other.md', content: expect.stringContaining('Second note') }),
    ]);
  });

  it('returns mixed ok/error items for valid and invalid paths', async () => {
    const ctx = createMockContext();
    const response = await dispatchMcpRequest(
      ctx,
      {
        jsonrpc: '2.0',
        id: 41,
        method: 'tools/call',
        params: { name: 'multi_get', arguments: { paths: ['Note.md', 'DoesNotExist.md'] } },
      },
      ENDPOINT,
    );

    const result = response?.result as { structuredContent: { items: Array<Record<string, unknown>> } };
    const items = result.structuredContent.items;
    expect(items[0]).toMatchObject({ ok: true, path: 'Note.md' });
    expect(items[1]).toMatchObject({ ok: false, error: 'note_not_found', path: 'DoesNotExist.md' });
  });

  it('caps at 20 paths when 25 are provided', async () => {
    const readNote = vi.fn(async () => 'content');
    const paths = Array.from({ length: 25 }, (_, i) => `note-${i}.md`);

    const response = await dispatchMcpRequest(
      createMockContext({ readNote }),
      {
        jsonrpc: '2.0',
        id: 42,
        method: 'tools/call',
        params: { name: 'multi_get', arguments: { paths } },
      },
      ENDPOINT,
    );

    expect(readNote).toHaveBeenCalledTimes(20);
    const result = response?.result as { structuredContent: { paths: string[] } };
    expect(result.structuredContent.paths).toHaveLength(20);
  });
});

// ---------------------------------------------------------------------------
// status tool
// ---------------------------------------------------------------------------

describe('tool: status', () => {
  it('returns model info, collection stats, and endpoint url', async () => {
    const ctx = createMockContext();
    const response = await dispatchMcpRequest(
      ctx,
      { jsonrpc: '2.0', id: 50, method: 'tools/call', params: { name: 'status', arguments: {} } },
      ENDPOINT,
    );

    const result = response?.result as { structuredContent: Record<string, unknown> };
    expect(result.structuredContent).toMatchObject({
      endpoint_url: ENDPOINT,
      model: { adapter: 'upstage', modelKey: 'embedding-passage', dims: 4096 },
      source_count: 2,
      embedded_source_count: 2,
      block_count: 4,
      embedded_block_count: 4,
      ready: true,
      embed_ready: true,
      status_state: 'idle',
    });
  });
});

// ---------------------------------------------------------------------------
// unknown tool
// ---------------------------------------------------------------------------

describe('tool: unknown', () => {
  it('returns unknown_tool error without throwing', async () => {
    const response = await dispatchMcpRequest(
      createMockContext(),
      { jsonrpc: '2.0', id: 60, method: 'tools/call', params: { name: 'does_not_exist', arguments: {} } },
      ENDPOINT,
    );

    const result = response?.result as { isError: boolean; structuredContent: Record<string, unknown> };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toBe('unknown_tool');
  });
});

// ---------------------------------------------------------------------------
// Standalone mode: Transformers.js unavailable
// ---------------------------------------------------------------------------

describe('standalone: Transformers.js unavailable', () => {
  it('returns embed_model_unavailable when embedQuery throws', async () => {
    const ctx = createMockContext({
      embedReady: false,
      statusState: 'error',
    });

    const response = await dispatchMcpRequest(
      ctx,
      { jsonrpc: '2.0', id: 70, method: 'tools/call', params: { name: 'query', arguments: { query: 'semantic search' } } },
      ENDPOINT,
    );

    const result = response?.result as { isError: boolean; structuredContent: Record<string, unknown> };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toBe('embed_model_unavailable');
    expect(ctx.embedQuery).not.toHaveBeenCalled();
  });
});
