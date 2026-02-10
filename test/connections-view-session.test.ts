/**
 * @file connections-view-session.test.ts
 * @description ConnectionsView behavior tests (session card removed in Phase 5)
 */

import { describe, expect, it, vi } from 'vitest';
import { ConnectionsView } from '../src/views/ConnectionsView';

function createPluginStub() {
  return {
    ready: true,
    embed_ready: true,
    status_state: 'idle',
    settings: {
      smart_sources: {
        embed_model: {
          adapter: 'openai',
        },
      },
      smart_notices: {
        muted: {},
      },
    },
    embed_model: {
      model_key: 'text-embedding-3-small',
      adapter: { dims: 1536 },
    },
    source_collection: {
      size: 2,
      all: [{ vec: [1, 2, 3] }, { vec: null }],
      data_dir: '/tmp/sources',
      get: vi.fn(() => null),
      nearest_to: vi.fn(async () => []),
    },
    block_collection: {
      data_dir: '/tmp/blocks',
    },
    getActiveEmbeddingContext: vi.fn(() => null),
    getEmbeddingKernelState: vi.fn(() => ({
      phase: 'idle',
      queue: {
        queuedTotal: 0,
      },
    })),
    reembedStaleEntities: vi.fn(async () => 0),
  } as any;
}

function createObsidianLikeContainer(): any {
  const addHelpers = (el: HTMLElement & Record<string, any>) => {
    el.empty = function empty() {
      this.innerHTML = '';
    };
    el.createDiv = function createDiv(opts: Record<string, any> = {}) {
      const div = document.createElement('div') as HTMLElement & Record<string, any>;
      if (opts.cls) div.className = opts.cls;
      if (opts.text) div.textContent = opts.text;
      this.appendChild(div);
      addHelpers(div);
      return div;
    };
    el.createEl = function createEl(tag: string, opts: Record<string, any> = {}) {
      const child = document.createElement(tag) as HTMLElement & Record<string, any>;
      if (opts.cls) child.className = opts.cls;
      if (opts.text) child.textContent = opts.text;
      this.appendChild(child);
      addHelpers(child);
      return child;
    };
  };

  const root = document.createElement('div') as HTMLElement & Record<string, any>;
  addHelpers(root);
  return root;
}

describe('ConnectionsView rendering states', () => {
  it('shows empty state when source is stale but no run/queue is active', async () => {
    const plugin = createPluginStub();
    plugin.status_state = 'idle';
    const staleSource = {
      key: 'note.md',
      vec: [1, 2, 3],
      is_unembedded: true,
    };
    plugin.source_collection.get = vi.fn(() => staleSource);
    plugin.source_collection.nearest_to = vi.fn(async () => [{ score: 0.9 }]);

    const view = new ConnectionsView({} as any, plugin);
    (view as any).container = document.createElement('div');
    const loadingSpy = vi.spyOn(view as any, 'showLoading').mockImplementation(() => {});
    const emptySpy = vi.spyOn(view as any, 'showEmpty').mockImplementation(() => {});

    await view.renderView('note.md');

    expect(loadingSpy).not.toHaveBeenCalled();
    expect(emptySpy).toHaveBeenCalled();
    expect(plugin.source_collection.nearest_to).not.toHaveBeenCalled();
  });

  it('shows loading state when source is stale and queue is active', async () => {
    const plugin = createPluginStub();
    const staleSource = {
      key: 'note.md',
      vec: [1, 2, 3],
      is_unembedded: true,
    };
    plugin.source_collection.get = vi.fn(() => staleSource);
    plugin.getEmbeddingKernelState = vi.fn(() => ({
      phase: 'idle',
      queue: { queuedTotal: 1 },
    }));

    const view = new ConnectionsView({} as any, plugin);
    (view as any).container = document.createElement('div');
    const loadingSpy = vi.spyOn(view as any, 'showLoading').mockImplementation(() => {});

    await view.renderView('note.md');

    expect(loadingSpy).toHaveBeenCalled();
  });

  it('refresh button triggers re-embed from loading state', async () => {
    const plugin = createPluginStub();
    const view = new ConnectionsView({} as any, plugin);
    (view as any).container = createObsidianLikeContainer();

    view.showLoading('Loading...');
    const button = (view as any).container.querySelector('button');
    expect(button).toBeTruthy();
    button?.dispatchEvent(new MouseEvent('click'));
    await Promise.resolve();

    expect(plugin.reembedStaleEntities).toHaveBeenCalledWith('Connections view refresh');
  });
});
