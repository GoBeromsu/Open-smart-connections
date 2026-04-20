import { describe, expect, it, vi } from 'vitest';
import { deriveConnectionsViewState } from '../src/ui/connections-view-state';
import type { ConnectionsReader } from '../src/types/connections-reader';

function makeReader(overrides: Partial<ConnectionsReader> = {}): ConnectionsReader {
  return {
    isReady: () => true,
    isEmbedReady: () => true,
    getStatusState: () => 'ok',
    hasPendingReImport: () => false,
    getBlocksForSource: () => [],
    getSource: () => null,
    ensureBlocksForSource: async () => [],
    getConnectionsForSource: async () => [],
    getEmbedRuntimeState: () => null,
    getSearchModelFingerprint: () => 'fp-1',
    getKernelPhase: () => 'idle',
    isDiscovering: () => false,
    ...overrides,
  };
}

describe('deriveConnectionsViewState — reader driven reads', () => {
  it('returns plugin_loading when reader.isReady() is false even if plugin.ready is true', async () => {
    const view: any = {
      plugin: {
        ready: true,
        block_collection: { for_source: () => [] },
        pendingReImportPaths: new Set<string>(),
      },
      reader: makeReader({ isReady: () => false }),
    };

    const state = await deriveConnectionsViewState(view, 'a.md');
    expect(state.type).toBe('plugin_loading');
  });


  it('uses reader.getConnectionsForSource for embedded blocks instead of plugin.block_collection queries', async () => {
    const pluginNearest = vi.fn(async () => { throw new Error('should not call plugin nearest'); });
    const results = [{ item: { key: 'other.md#A', source_key: 'other.md' }, score: 0.9 }];
    const view: any = {
      plugin: {
        ready: true,
        block_collection: {
          for_source: () => [{ has_embed: () => true }],
          nearest: pluginNearest,
          ensure_entity_vector: vi.fn(async () => {}),
        },
        pendingReImportPaths: new Set<string>(),
      },
      reader: makeReader({
        ensureBlocksForSource: async () => [{ has_embed: () => true }],
        getConnectionsForSource: async () => results,
      }),
    };

    const state = await deriveConnectionsViewState(view, 'a.md');
    expect(state).toEqual({ type: 'results', path: 'a.md', results });
    expect(pluginNearest).not.toHaveBeenCalled();
  });

  it('returns pending_import when the reader reports it, even if plugin pending set is empty', async () => {
    const view: any = {
      plugin: {
        ready: true,
        block_collection: { for_source: () => [] },
        pendingReImportPaths: new Set<string>(),
      },
      reader: makeReader({ hasPendingReImport: () => true }),
    };

    const state = await deriveConnectionsViewState(view, 'a.md');
    expect(state).toEqual({ type: 'pending_import', path: 'a.md' });
  });
});
