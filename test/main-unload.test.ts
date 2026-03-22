import { describe, expect, it, vi, afterEach } from 'vitest';
import { App } from 'obsidian';

const { registerCommandsMock } = vi.hoisted(() => ({
  registerCommandsMock: vi.fn(),
}));

vi.mock('../src/domain/entities', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    closeSqliteDatabases: vi.fn(async () => {}),
  };
});

vi.mock('../src/ui/commands', () => ({
  registerCommands: registerCommandsMock,
}));

import SmartConnectionsPlugin from '../src/main';
import { closeSqliteDatabases } from '../src/domain/entities';

function createPlugin() {
  const app = new App();
  (app as any).workspace.trigger = vi.fn();

  const plugin = new (SmartConnectionsPlugin as any)(app, {
    id: 'open-connections',
    version: '0.0.0-test',
  }) as SmartConnectionsPlugin;

  plugin.settings = {
    smart_sources: {
      embed_model: {
        adapter: 'openai',
        openai: { model_key: 'text-embedding-3-small' },
      },
    },
    smart_blocks: {},
  } as any;

  return plugin;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('SmartConnectionsPlugin onunload', () => {
  it('halts runtime state and closes sqlite databases during disable/unload', () => {
    const plugin = createPlugin();

    const notices = {
      unload: vi.fn(),
      remove: vi.fn(),
    };
    const embeddingPipeline = {
      halt: vi.fn(),
    };
    const embeddingJobQueue = {
      clear: vi.fn(),
    };
    const embedAdapter = {
      unload: vi.fn(async () => {}),
    };
    const env = {
      unload: vi.fn(),
    };

    (plugin as any)._notices = notices;
    plugin.ready = true;
    plugin.embed_run_seq = 41;
    plugin.current_embed_context = {
      runId: 41,
      phase: 'running',
      reason: 'unit-test',
      adapter: 'openai',
      modelKey: 'text-embedding-3-small',
      dims: 1536,
      currentEntityKey: 'note#h1',
      currentSourcePath: 'note.md',
      startedAt: Date.now(),
      current: 1,
      total: 2,
      blockTotal: 2,
      saveCount: 1,
      sourceDataDir: '/tmp/sources',
      blockDataDir: '/tmp/blocks',
      followupQueued: false,
      error: null,
    } as any;
    plugin.pendingReImportPaths.add('stale.md');
    plugin.source_collection = { all: [] } as any;
    plugin.block_collection = { all: [] } as any;
    plugin.embedding_pipeline = embeddingPipeline as any;
    plugin.embedding_job_queue = embeddingJobQueue as any;
    plugin.embed_adapter = embedAdapter as any;
    plugin.env = env as any;

    plugin.onunload();

    expect(plugin._unloading).toBe(true);
    expect(plugin.ready).toBe(false);
    expect(plugin.current_embed_context).toBeNull();
    expect(plugin.pendingReImportPaths.size).toBe(0);
    expect(plugin.embedding_pipeline).toBeUndefined();
    expect(plugin.embedding_job_queue).toBeUndefined();
    expect(plugin.source_collection).toBeUndefined();
    expect(plugin.block_collection).toBeUndefined();
    expect(plugin.status_state).toBe('idle');
    expect(plugin.embed_run_seq).toBe(41);
    expect(embeddingPipeline.halt).toHaveBeenCalled();
    expect(embeddingJobQueue.clear).toHaveBeenCalledWith('Plugin reset');
    expect(notices.unload).toHaveBeenCalledTimes(1);
    expect(embedAdapter.unload).toHaveBeenCalledTimes(1);
    expect(env.unload).toHaveBeenCalledTimes(1);
    expect(closeSqliteDatabases).toHaveBeenCalledTimes(1);
  });

  it('does not register UI hooks after unload interrupts onload initialization', async () => {
    const plugin = createPlugin();
    const initGate = deferred<void>();

    (plugin.app.workspace as any).layoutReady = true;
    vi.spyOn(plugin, 'loadSettings').mockResolvedValue();
    vi.spyOn(plugin, 'initialize').mockImplementation(async () => {
      await initGate.promise;
    });

    const registerViewSpy = vi.spyOn(plugin, 'registerView').mockImplementation(() => undefined as any);
    const addSettingTabSpy = vi.spyOn(plugin, 'addSettingTab').mockImplementation(() => undefined as any);
    const addRibbonIconSpy = vi.spyOn(plugin, 'addRibbonIcon').mockImplementation(() => undefined as any);
    const registerMarkdownSpy = vi.fn();
    (plugin as any).registerMarkdownCodeBlockProcessor = registerMarkdownSpy;

    const loadPromise = plugin.onload();
    await Promise.resolve();

    plugin.onunload();
    initGate.resolve();
    await loadPromise;

    expect(registerViewSpy).not.toHaveBeenCalled();
    expect(addSettingTabSpy).not.toHaveBeenCalled();
    expect(addRibbonIconSpy).not.toHaveBeenCalled();
    expect(registerMarkdownSpy).not.toHaveBeenCalled();
    expect(registerCommandsMock).not.toHaveBeenCalled();
  });
});
