/**
 * @file lookup-model-switch.test.ts
 * @description LookupView safety behavior tests for model switching
 */

import { describe, expect, it, vi } from 'vitest';
import { LookupView } from '../src/views/LookupView';
import * as lookupModule from '../core/search/lookup';

function createPluginStub() {
  return {
    embed_ready: true,
    embed_model: {
      adapter: {},
    },
    source_collection: {
      all: [],
    },
    block_collection: {
      all: [],
    },
  } as any;
}

describe('LookupView model-switch safety', () => {
  it('clears visible results when model is switched', () => {
    const plugin = createPluginStub();
    const view = new LookupView({} as any, plugin);
    (view as any).resultsContainer = document.createElement('div');
    const showEmptySpy = vi.spyOn(view as any, 'showEmpty').mockImplementation(() => {});

    (view as any).handleModelSwitched();

    expect(showEmptySpy).toHaveBeenCalledWith(
      'Embedding model changed. Results will refresh after active-model embeddings are ready.',
    );
  });

  it('filters stale entities before semantic lookup', async () => {
    const plugin = createPluginStub();
    plugin.source_collection.all = [
      { key: 'source-fresh.md', vec: [1, 0], is_unembedded: false },
      { key: 'source-stale.md', vec: [1, 0], is_unembedded: true },
      { key: 'source-empty.md', vec: null, is_unembedded: false },
    ];
    plugin.block_collection.all = [
      { key: 'source-fresh.md#h1', vec: [0, 1], is_unembedded: false },
      { key: 'source-stale.md#h1', vec: [0, 1], is_unembedded: true },
    ];

    const lookupSpy = vi
      .spyOn(lookupModule, 'lookup')
      .mockResolvedValue([]);

    const view = new LookupView({} as any, plugin);
    (view as any).resultsContainer = document.createElement('div');
    vi.spyOn(view as any, 'showLoading').mockImplementation(() => {});
    vi.spyOn(view as any, 'renderResults').mockImplementation(() => {});

    await view.performSearch('query');

    expect(lookupSpy).toHaveBeenCalledTimes(1);
    const entities = lookupSpy.mock.calls[0][2] as Array<{ key: string }>;
    expect(entities.map((item) => item.key)).toEqual([
      'source-fresh.md',
      'source-fresh.md#h1',
    ]);
  });
});
