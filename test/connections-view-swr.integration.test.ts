import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { ConnectionsView } from '../src/ui/ConnectionsView';
import { createConnectionsReader } from '../src/ui/connections-reader-adapter';
import { invalidateConnectionsCache } from '../src/ui/block-connections';

function makeResult(sourcePath: string, score = 0.9) {
  return {
    item: { key: `${sourcePath}#Section`, source_key: sourcePath, evictVec: vi.fn() },
    score,
  };
}

function createPluginStub(overrides: Record<string, unknown> = {}) {
  const nearest = vi
    .fn()
    .mockResolvedValueOnce([makeResult('old.md')])
    .mockResolvedValueOnce([makeResult('new.md')]);

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
      all: [{ key: 'note.md#Seed', source_key: 'note.md', has_embed: () => true, vec: [1, 2, 3], evictVec: vi.fn() }],
      data_adapter: { save: vi.fn(async () => {}) },
      for_source(path: string) { return (this.all as any[]).filter((b: any) => b.source_key === path); },
      import_source_blocks: vi.fn(async () => {}),
      nearest,
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
      if (opts.attr) for (const [k, v] of Object.entries(opts.attr)) div.setAttribute(k, String(v));
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

beforeEach(() => {
  invalidateConnectionsCache();
});

afterEach(() => {
  invalidateConnectionsCache();
});

describe('ConnectionsView SWR integration', () => {
  it('serves the same path + fingerprint from the view cache without re-deriving state', async () => {
    const plugin = createPluginStub();
    const view = createView(plugin);
    const deriveSpy = vi.spyOn(view, 'deriveViewState');
    const emptySpy = vi.spyOn(view.container, 'empty');

    await view.renderView('note.md');
    await view.renderView('note.md');

    expect(deriveSpy).toHaveBeenCalledTimes(1);
    expect(emptySpy).toHaveBeenCalledTimes(1);
    expect(plugin.block_collection.nearest).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('old');
  });

  it('invalidates cached results when the search fingerprint changes and recomputes fresh results', async () => {
    const plugin = createPluginStub();
    const view = createView(plugin);
    const loadingSpy = vi.spyOn(view, 'showLoading');

    await view.renderView('note.md');
    expect(view.container.textContent).toContain('old');

    plugin._search_embed_model.fingerprint = 'fp-2';
    plugin._embed_state.modelFingerprint = 'fp-2';

    await view.renderView('note.md');

    expect(loadingSpy).toHaveBeenCalledWith('Embedding model changed. Re-embedding in progress.');
    expect(plugin.block_collection.nearest).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toContain('new');
  });


  it('always recomputes when the reader cannot provide a fingerprint', async () => {
    const plugin = createPluginStub({
      _search_embed_model: { fingerprint: null },
      _embed_state: { phase: 'idle', modelFingerprint: null, lastError: null },
    });
    const view = createView(plugin);

    await view.renderView('note.md');
    await view.renderView('note.md');

    expect(plugin.block_collection.nearest).toHaveBeenCalledTimes(2);
  });

  it('bypasses cached results when the path is pending re-import', async () => {
    const plugin = createPluginStub();
    const view = createView(plugin);

    await view.renderView('note.md');
    expect(view.container.textContent).toContain('old');

    plugin.pendingReImportPaths.add('note.md');

    await view.renderView('note.md');

    expect(plugin.block_collection.nearest).toHaveBeenCalledTimes(1);
    expect(view.container.textContent).toContain('Importing note');
  });

  it('revalidates exactly once when embed state changes from running to idle', async () => {
    const app = new App();
    const plugin = createPluginStub();
    const reader = plugin.connectionsReader ?? createConnectionsReader(plugin);
    plugin.connectionsReader = reader;
    const view = new ConnectionsView({ app } as any, plugin, reader);
    const root = document.createElement('div');
    root.appendChild(document.createElement('div'));
    root.appendChild(createObsidianLikeContainer());
    (view as any).containerEl = root;
    app.workspace.getActiveFile = () => null;

    await view.onOpen();
    await view.renderView('note.md');

    const renderSpy = vi.spyOn(view, 'renderView');
    app.workspace.trigger('open-connections:embed-state-changed', { prev: 'running', phase: 'idle' });
    const rerender = renderSpy.mock.results[0]?.value;
    if (rerender && typeof rerender.then === 'function') await rerender;

    expect(renderSpy).toHaveBeenCalledTimes(1);
    expect(renderSpy).toHaveBeenCalledWith('note.md');
    expect(plugin.block_collection.nearest).toHaveBeenCalledTimes(2);
    expect(view.container.textContent).toContain('new');
  });
});
