import { beforeEach, describe, expect, it } from 'vitest';
import { invalidateConnectionsCache } from '../src/ui/block-connections';
import { createConnectionsReader } from '../src/ui/connections-reader-adapter';

describe('createConnectionsReader', () => {
  beforeEach(() => invalidateConnectionsCache());
  const fakePlugin = {
    ready: true,
    embed_ready: false,
    status_state: 'ok',
    pendingReImportPaths: new Set(['a.md']),
    block_collection: {
      for_source: (path: string) => (path === 'x.md' ? [{ has_embed: () => true, key: 'x.md#h1', source_key: 'x.md', vec: [1, 2, 3], evictVec: () => undefined }] : []),
      ensure_entity_vector: async () => {},
      nearest: async () => [{ item: { key: 'other.md#h1', source_key: 'other.md', evictVec: () => undefined }, score: 0.9 }],
    },
    source_collection: {
      get: (path: string) => (path === 'x.md' ? { key: 'x.md', path: 'x.md' } : null),
    },
    getEmbedRuntimeState: () => ({ serving: { kind: 'ready' } }),
    _search_embed_model: { fingerprint: 'fp-1' },
    _embed_state: { phase: 'running' },
    _discovering: true,
  } as any;

  it('exposes plugin reads through the reader surface', async () => {
    const reader = createConnectionsReader(fakePlugin);

    expect(reader.isReady()).toBe(true);
    expect(reader.isEmbedReady()).toBe(false);
    expect(reader.getStatusState()).toBe('ok');
    expect(reader.hasPendingReImport('a.md')).toBe(true);
    expect(reader.hasPendingReImport('b.md')).toBe(false);
    expect(reader.getBlocksForSource('x.md')).toHaveLength(1);
    expect(reader.getSource('x.md')?.path).toBe('x.md');
    expect(reader.getEmbedRuntimeState()).toEqual({ serving: { kind: 'ready' } });
    expect(await reader.getConnectionsForSource('x.md', 25)).toEqual([{ item: { key: 'other.md#h1', source_key: 'other.md', evictVec: expect.any(Function) }, score: 0.9 }]);
    expect(reader.getSearchModelFingerprint()).toBe('fp-1');
    expect(reader.getKernelPhase()).toBe('running');
    expect(reader.isDiscovering()).toBe(true);
  });

  it('returns safe defaults when optional fields are absent', async () => {
    const reader = createConnectionsReader({ ready: false, _embed_state: { phase: 'idle' } } as any);

    expect(reader.isReady()).toBe(false);
    expect(reader.isEmbedReady()).toBe(false);
    expect(reader.getStatusState()).toBe('');
    expect(reader.hasPendingReImport('missing.md')).toBe(false);
    expect(reader.getBlocksForSource('missing.md')).toEqual([]);
    expect(reader.getSource('missing.md')).toBeNull();
    expect(reader.getEmbedRuntimeState()).toBeNull();
    expect(await reader.getConnectionsForSource('missing.md')).toEqual([]);
    expect(reader.getSearchModelFingerprint()).toBeNull();
    expect(reader.getKernelPhase()).toBe('idle');
    expect(reader.isDiscovering()).toBe(false);
  });
});
