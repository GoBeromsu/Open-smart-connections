import { describe, expect, it, vi } from 'vitest';
import { dispatchMcpRequest } from '../src/domain/mcp-dispatch';
import type { McpContext, McpSearchResult, McpCollectionStats, McpModelInfo } from '../src/types/mcp-context';

function makeCtx(overrides: Partial<McpContext> = {}): McpContext {
  const defaultResults: McpSearchResult[] = [
    {
      path: 'Folder/Note.md',
      score: 0.92,
      blockKey: 'Folder/Note.md#Heading',
      headings: ['Heading'],
      preview: 'Relevant block text',
    },
  ];

  return {
    ready: true,
    embedReady: true,
    statusState: 'idle',
    version: '1.2.3',
    logger: { warn: vi.fn() },

    readNote: vi.fn(async (path: string) => {
      const notes: Record<string, string> = {
        'Note.md': '# Note\n\nHello world',
        'Folder/Other.md': '# Other\n\nSecond note',
      };
      return notes[path] ?? null;
    }),

    noteExists: vi.fn((path: string) => {
      return ['Note.md', 'Folder/Other.md'].includes(path);
    }),

    embedQuery: vi.fn(async () => [1, 0, 0]),

    searchNearest: vi.fn(async () => defaultResults),

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

    getStats: () => ({
      sourceCount: 2,
      embeddedSourceCount: 2,
      blockCount: 4,
      embeddedBlockCount: 4,
    }),

    ...overrides,
  };
}

describe('dispatchMcpRequest', () => {
  it('handles initialize', async () => {
    const response = await dispatchMcpRequest(
      makeCtx(),
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } },
      'http://127.0.0.1:27124/mcp',
    );

    expect(response?.result).toEqual({
      protocolVersion: '2025-03-26',
      serverInfo: { name: 'open-connections', version: '1.2.3' },
      capabilities: { tools: {} },
    });
  });

  it('lists the MCP tools', async () => {
    const response = await dispatchMcpRequest(
      makeCtx(),
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      'http://127.0.0.1:27124/mcp',
    );

    const tools = (response?.result as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
    expect(tools).toEqual(['query', 'connections', 'get', 'multi_get', 'status']);
  });

  it('returns status payload for tools/call', async () => {
    const response = await dispatchMcpRequest(
      makeCtx(),
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'status', arguments: {} } },
      'http://127.0.0.1:27124/mcp',
    );

    const result = response?.result as { structuredContent: Record<string, unknown> };
    expect(result.structuredContent.endpoint_url).toBe('http://127.0.0.1:27124/mcp');
    expect(result.structuredContent.model).toEqual({ adapter: 'upstage', modelKey: 'embedding-passage', dims: 4096 });
  });

  it('dedupes query results to note-level matches by default', async () => {
    const response = await dispatchMcpRequest(
      makeCtx(),
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'query', arguments: { query: 'hello world' } } },
      'http://127.0.0.1:27124/mcp',
    );

    const result = response?.result as { structuredContent: { matches: Array<Record<string, unknown>> } };
    expect(result.structuredContent.matches).toEqual([
      expect.objectContaining({
        path: 'Folder/Note.md',
        block_key: 'Folder/Note.md#Heading',
      }),
    ]);
  });

  it('returns connection results', async () => {
    const response = await dispatchMcpRequest(
      makeCtx(),
      { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'connections', arguments: { path: 'Note.md' } } },
      'http://127.0.0.1:27124/mcp',
    );

    const result = response?.result as { structuredContent: { matches: Array<Record<string, unknown>> } };
    expect(result.structuredContent.matches).toEqual([
      expect.objectContaining({
        path: 'Related.md',
        block_key: 'Related.md#Section',
      }),
    ]);
  });

  it('returns note contents for get', async () => {
    const response = await dispatchMcpRequest(
      makeCtx(),
      { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'get', arguments: { path: 'Note.md' } } },
      'http://127.0.0.1:27124/mcp',
    );

    const result = response?.result as { structuredContent: { content: string } };
    expect(result.structuredContent.content).toContain('Hello world');
  });

  it('returns multiple note contents for multi_get', async () => {
    const response = await dispatchMcpRequest(
      makeCtx(),
      {
        jsonrpc: '2.0',
        id: 6.1,
        method: 'tools/call',
        params: { name: 'multi_get', arguments: { paths: ['Note.md', 'Folder/Other.md'] } },
      },
      'http://127.0.0.1:27124/mcp',
    );

    const result = response?.result as { structuredContent: { items: Array<Record<string, unknown>> } };
    expect(result.structuredContent.items).toEqual([
      expect.objectContaining({ ok: true, path: 'Note.md', content: expect.stringContaining('Hello world') }),
      expect.objectContaining({ ok: true, path: 'Folder/Other.md', content: expect.stringContaining('Second note') }),
    ]);
  });

  it('surfaces tool-level errors instead of crashing', async () => {
    const ctx = makeCtx({ embedReady: false });
    const response = await dispatchMcpRequest(
      ctx,
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'query', arguments: { query: 'blocked' } } },
      'http://127.0.0.1:27124/mcp',
    );

    const result = response?.result as { isError: boolean; structuredContent: Record<string, unknown> };
    expect(result.isError).toBe(true);
    expect(result.structuredContent.error).toBe('embed_model_unavailable');
  });

  it('truncates multi_get to 20 paths', async () => {
    const paths = Array.from({ length: 25 }, (_, i) => `note-${i}.md`);
    const readNote = vi.fn(async () => 'content');

    const response = await dispatchMcpRequest(
      makeCtx({ readNote }),
      {
        jsonrpc: '2.0',
        id: 8,
        method: 'tools/call',
        params: { name: 'multi_get', arguments: { paths } },
      },
      'http://127.0.0.1:27124/mcp',
    );

    expect(readNote).toHaveBeenCalledTimes(20);
    const result = response?.result as { structuredContent: { paths: string[] } };
    expect(result.structuredContent.paths).toHaveLength(20);
  });
});
