import { describe, expect, it, vi } from 'vitest';
import { ConnectionsView } from '../src/ui/ConnectionsView';
import { createConnectionsReader } from '../src/ui/connections-reader-adapter';

function createPluginStub(overrides: Record<string, unknown> = {}) {
  return {
    ready: true,
    embed_ready: true,
    status_state: 'idle',
    settings: {
      smart_sources: { embed_model: { adapter: 'openai' } },
      smart_notices: { muted: {} },
    },
    embed_adapter: { model_key: 'text-embedding-3-small', dims: 1536 },
    source_collection: { get: vi.fn(() => null) },
    block_collection: {
      all: [] as any[],
      data_adapter: { save: vi.fn(async () => {}) },
      for_source(path: string) { return (this.all as any[]).filter((b: any) => b.source_key === path); },
      import_source_blocks: vi.fn(async () => {}),
      nearest: vi.fn(async () => []),
      ensure_entity_vector: vi.fn(async () => {}),
    },
    open_note: vi.fn(),
    runEmbeddingJob: vi.fn(async () => ({})),
    reembedStaleEntities: vi.fn(async () => 0),
    pendingReImportPaths: new Set<string>(),
    getEmbedRuntimeState: vi.fn(() => null),
    _search_embed_model: { fingerprint: 'fp-1' },
    _embed_state: { phase: 'idle', modelFingerprint: 'fp-1', lastError: null },
    ...overrides,
  } as any;
}

function createObsidianLikeContainer(): any {
  const addHelpers = (el: HTMLElement & Record<string, any>) => {
    const host = el as any;
    host.empty = function empty() { while (this.firstChild) this.removeChild(this.firstChild); };
    host.addClass = function addClass(...cls: string[]) { this.classList.add(...cls); };
    host.removeClass = function removeClass(...cls: string[]) { this.classList.remove(...cls); };
    host.toggleClass = function toggleClass(cls: string, force: boolean) { this.classList.toggle(cls, force); };
    host.setText = function setText(text: string) { this.textContent = text; };
    host.createDiv = function createDiv(opts: Record<string, any> = {}) {
      const div = document.createElement('div') as HTMLElement & Record<string, any>;
      if (opts.cls) div.className = opts.cls;
      if (opts.text) div.textContent = opts.text;
      this.appendChild(div);
      addHelpers(div);
      return div;
    };
    host.createSpan = function createSpan(opts: Record<string, any> = {}) { return this.createEl('span', opts); };
    host.createEl = function createEl(tag: string, opts: Record<string, any> = {}) {
      const child = document.createElement(tag) as HTMLElement & Record<string, any>;
      if (opts.cls) child.className = opts.cls;
      if (opts.text) child.textContent = opts.text;
      if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) child.setAttribute(k, String(v));
      this.appendChild(child);
      addHelpers(child);
      return child;
    };
  };

  const root = document.createElement('div') as HTMLElement & Record<string, any>;
  addHelpers(root);
  return root;
}

function createView(plugin: any) {
  const reader = plugin.connectionsReader ?? createConnectionsReader(plugin);
  plugin.connectionsReader = reader;
  const view = new ConnectionsView({} as any, plugin, reader);
  (view as any).container = createObsidianLikeContainer();
  return view;
}

describe('ConnectionsView renderView characterization baseline', () => {
  it('shows plugin loading when the plugin is not ready', async () => {
    const plugin = createPluginStub({ ready: false });
    const view = createView(plugin);

    await view.renderView('note.md');

    expect(view.container.textContent).toContain('Open Connections is initializing');
  });

  it('shows pending import when the target path is queued for re-import', async () => {
    const plugin = createPluginStub();
    plugin.pendingReImportPaths.add('note.md');
    const view = createView(plugin);

    await view.renderView('note.md');

    expect(view.container.textContent).toContain('Importing note');
  });

  it('shows note-too-short when there are no blocks and no source to import', async () => {
    const plugin = createPluginStub();
    const view = createView(plugin);

    await view.renderView('note.md');

    expect(view.container.textContent).toContain('Note is too short');
  });

  it('shows embed loading when blocks exist but no vectors are ready', async () => {
    const plugin = createPluginStub({ embed_ready: false });
    plugin.block_collection.all = [{ source_key: 'note.md', has_embed: () => false, queue_embed: vi.fn(), _queue_embed: false }];
    const view = createView(plugin);

    await view.renderView('note.md');

    expect(view.container.textContent).toContain('Open Connections is loading');
  });

  it('shows model error when serving is unavailable', async () => {
    const plugin = createPluginStub({ status_state: 'error', embed_ready: false });
    plugin.block_collection.all = [{ source_key: 'note.md', has_embed: () => false, queue_embed: vi.fn(), _queue_embed: false }];
    plugin.getEmbedRuntimeState = vi.fn(() => ({
      snapshot: { phase: 'error', modelFingerprint: null, lastError: 'boom' },
      model: { kind: 'unavailable', error: 'boom' },
      backfill: { kind: 'failed', error: 'boom' },
      serving: { kind: 'unavailable', error: 'boom' },
      profiling: {
        activeStage: null,
        activeSince: null,
        recentStages: [],
        counters: { saveCount: 0, followupScheduledCount: 0, progressEventCount: 0, connectionsViewRenderCount: 0 },
      },
    }));
    const view = createView(plugin);

    await view.renderView('note.md');

    expect(view.container.textContent).toContain('Embedding model failed to initialize');
  });

  it('shows no connections when nearest-search returns nothing for embedded blocks', async () => {
    const plugin = createPluginStub();
    plugin.block_collection.all = [{ source_key: 'note.md', has_embed: () => true, vec: [1, 2, 3], evictVec: vi.fn() }];
    plugin.block_collection.nearest = vi.fn(async () => []);
    const view = createView(plugin);

    await view.renderView('note.md');

    expect(view.container.textContent).toContain('No related notes found');
  });
});
