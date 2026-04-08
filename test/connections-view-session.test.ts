import { describe, expect, it, vi } from 'vitest';
import { ConnectionsView } from '../src/ui/ConnectionsView';

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
    embed_adapter: {
      model_key: 'text-embedding-3-small',
      dims: 1536,
    },
    source_collection: {
      size: 2,
      all: [],
      data_dir: '/tmp/sources',
      get: vi.fn(() => null),
    },
    block_collection: {
      data_dir: '/tmp/blocks',
      all: [] as any[],
      for_source(path: string) { return (this.all as any[]).filter((b: any) => b.source_key === path); },
      ensure_entity_vector: vi.fn(async () => {}),
      nearest: vi.fn(async () => []),
    },
    open_note: vi.fn(),
    runEmbeddingJob: vi.fn(async () => ({})),
    getActiveEmbeddingContext: vi.fn(() => null),
    current_embed_context: null,
    getEmbeddingKernelState: vi.fn(() => ({
      phase: 'idle',
      queue: {
        queuedTotal: 0,
      },
    })),
    reembedStaleEntities: vi.fn(async () => 0),
    pendingReImportPaths: new Set<string>(),
  } as any;
}

function createObsidianLikeContainer(): any {
  const addHelpers = (el: HTMLElement & Record<string, any>) => {
    el.empty = function empty() {
      while (this.firstChild) this.removeChild(this.firstChild);
    };
    el.addClass = function addClass(cls: string) {
      this.classList.add(cls);
    };
    el.removeClass = function removeClass(cls: string) {
      this.classList.remove(cls);
    };
    el.toggleClass = function toggleClass(cls: string, force: boolean) {
      this.classList.toggle(cls, force);
    };
    el.setText = function setText(text: string) {
      this.textContent = text;
    };
    el.createDiv = function createDiv(opts: Record<string, any> = {}) {
      const div = document.createElement('div') as HTMLElement & Record<string, any>;
      if (opts.cls) div.className = opts.cls;
      if (opts.text) div.textContent = opts.text;
      this.appendChild(div);
      addHelpers(div);
      return div;
    };
    el.createSpan = function createSpan(opts: Record<string, any> = {}) {
      return this.createEl('span', opts);
    };
    el.createEl = function createEl(tag: string, opts: Record<string, any> = {}) {
      const child = document.createElement(tag) as HTMLElement & Record<string, any>;
      if (opts.cls) child.className = opts.cls;
      if (opts.text) child.textContent = opts.text;
      if (opts.attr) {
        for (const [k, v] of Object.entries(opts.attr)) child.setAttribute(k, v as string);
      }
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
  it('calls block_collection.nearest when blocks with vectors exist for the active file', async () => {
    const plugin = createPluginStub();
    plugin.status_state = 'idle';
    const embeddedBlock = {
      key: 'note.md#Section',
      source_key: 'note.md',
      vec: [1, 2, 3],
      is_unembedded: false,
      has_embed: () => true,
      evictVec: vi.fn(),
    };
    plugin.block_collection.all = [embeddedBlock];
    plugin.block_collection.nearest = vi.fn(async () => [
      { item: { key: 'other.md#Topic', source_key: 'other.md' }, score: 0.9 },
    ]);

    const view = new ConnectionsView({} as any, plugin);
    (view as any).container = createObsidianLikeContainer();

    await view.renderView('note.md');

    // Should search blocks and render results
    expect(plugin.block_collection.nearest).toHaveBeenCalled();
  });

  it('shows loading state when blocks exist but have no vectors yet', async () => {
    const plugin = createPluginStub();
    const unembeddedBlock = {
      key: 'note.md#Section',
      source_key: 'note.md',
      vec: null,
      is_unembedded: true,
      has_embed: () => false,
      queue_embed: vi.fn(),
      _queue_embed: false,
    };
    plugin.block_collection.all = [unembeddedBlock];
    plugin.runEmbeddingJob = vi.fn(async () => ({}));

    const view = new ConnectionsView({} as any, plugin);
    (view as any).container = createObsidianLikeContainer();

    await view.renderView('note.md');

    // Should show loading state (no embedded blocks to search with)
    const text = (view as any).container.textContent;
    expect(text).toContain('Embedding');
  });

  it('renders existing connections even when the latest embedding run failed', async () => {
    const plugin = createPluginStub();
    plugin.status_state = 'error';
    plugin.embed_ready = false;
    const embeddedBlock = {
      key: 'failed-note.md#Section',
      source_key: 'failed-note.md',
      vec: [1, 2, 3],
      is_unembedded: false,
      has_embed: () => true,
      evictVec: vi.fn(),
    };
    plugin.block_collection.all = [embeddedBlock];
    plugin.block_collection.nearest = vi.fn(async () => [
      { item: { key: 'other.md#Topic', source_key: 'other.md' }, score: 0.9 },
    ]);

    const view = new ConnectionsView({} as any, plugin);
    (view as any).container = createObsidianLikeContainer();

    await view.renderView('failed-note.md');

    expect(plugin.block_collection.nearest).toHaveBeenCalled();
    expect((view as any).container.textContent).not.toContain('Embedding model failed to initialize');
  });


  it('shows degraded messaging instead of generic model-init messaging when serving is degraded', async () => {
    const plugin = createPluginStub();
    plugin.status_state = 'error';
    plugin.embed_ready = false;
    plugin.getEmbedRuntimeState = vi.fn(() => ({
      snapshot: { phase: 'error', modelFingerprint: 'upstage:embedding-passage:4096', lastError: 'Array buffer allocation failed' },
      model: { kind: 'ready', fingerprint: 'upstage:embedding-passage:4096' },
      backfill: { kind: 'failed', error: 'Array buffer allocation failed' },
      serving: { kind: 'degraded', reason: 'backfill_failed', error: 'Array buffer allocation failed' },
    }));

    const unembeddedBlock = {
      key: 'note.md#Section',
      source_key: 'note.md',
      vec: null,
      is_unembedded: true,
      has_embed: () => false,
      queue_embed: vi.fn(),
      _queue_embed: false,
    };
    plugin.block_collection.all = [unembeddedBlock];

    const view = new ConnectionsView({} as any, plugin);
    (view as any).container = createObsidianLikeContainer();

    await view.renderView('note.md');

    const text = (view as any).container.textContent;
    expect(text).toContain('Embedding backlog hit an error');
    expect(text).not.toContain('Embedding model failed to initialize');
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
