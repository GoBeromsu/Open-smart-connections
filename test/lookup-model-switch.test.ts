/**
 * @file lookup-model-switch.test.ts
 * @description LookupView safety behavior tests for model switching
 */

import { describe, expect, it, vi } from 'vitest';
import { LookupView } from '../src/views/LookupView';

function createPluginStub() {
  const nearest = vi.fn().mockResolvedValue([]);
  return {
    embed_ready: true,
    embed_model: {
      adapter: {
        embed_batch: vi.fn().mockResolvedValue([{ vec: [1, 0] }]),
      },
    },
    source_collection: {
      all: [],
      nearest,
    },
    block_collection: {
      all: [],
      nearest,
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

  it('queries active collections through nearest API', async () => {
    const plugin = createPluginStub();

    const view = new LookupView({} as any, plugin);
    (view as any).resultsContainer = document.createElement('div');
    (view as any).searchMetaEl = document.createElement('div');
    vi.spyOn(view as any, 'showLoading').mockImplementation(() => {});
    vi.spyOn(view as any, 'showError').mockImplementation(() => {});
    vi.spyOn(view as any, 'renderResults').mockImplementation(() => {});

    await view.performSearch('query');

    expect(plugin.embed_model.adapter.embed_batch).toHaveBeenCalledTimes(1);
    expect(plugin.source_collection.nearest).toHaveBeenCalledWith([1, 0], { limit: 20 });
    expect(plugin.block_collection.nearest).toHaveBeenCalledWith([1, 0], { limit: 20 });
  });
});
