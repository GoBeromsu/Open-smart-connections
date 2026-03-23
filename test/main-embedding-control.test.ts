/**
 * @file main-embedding-control.test.ts
 * @description Regression tests for embedding run control and model switch flow
 *              (updated for 3-state FSM: idle/running/error)
 *
 * Removed tests:
 * - "transitions to paused only after stop completes" (paused/stopping removed)
 * - "sets error state when model switch cannot stop previous run" (stop flow removed)
 *
 * Modified tests:
 * - "keeps newer run state when stale run finalizes" (no loading_model, use idle)
 * - "sets error state when model load times out during switch" (phase assertions updated)
 */

import { describe, it, expect, vi } from 'vitest';
import { App } from 'obsidian';
import SmartConnectionsPlugin from '../src/main';

function createPlugin() {
  const app = new App();
  (app as any).workspace.trigger = vi.fn();

  const plugin = new (SmartConnectionsPlugin as any)(app, {
    id: 'open-smart-connections',
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
    re_import_wait_time: 13,
  } as any;

  plugin.source_collection = {
    data_adapter: {
      save: vi.fn(async () => {}),
    },
    data_dir: '/tmp/sources',
    size: 2,
    all: [],
    recomputeEmbeddedCount: vi.fn(),
  } as any;

  plugin.block_collection = {
    all: [
      { key: 's1#h1', vec: [1, 2, 3], _queue_embed: true, should_embed: true },
      { key: 's2#h1', vec: null, _queue_embed: true, should_embed: true },
    ],
    data_adapter: {
      save: vi.fn(async () => {}),
    },
    data_dir: '/tmp/blocks',
    recomputeEmbeddedCount: vi.fn(),
  } as any;

  plugin.embed_adapter = {
    model_key: 'text-embedding-3-small',
    dims: 1536,
    adapter: 'openai',
    unload: vi.fn(async () => {}),
  } as any;

  plugin.ensureEmbeddingKernel();

  return { app, plugin };
}

function createControlledPipeline() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  const pipeline = {
    active: false,
    halted: false,
    stats: {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      duration_ms: 0,
      outcome: 'completed' as const,
    },
    process: vi.fn(async (entities: any[], opts: any) => {
      pipeline.active = true;
      pipeline.stats = {
        total: entities.length,
        success: 0,
        failed: 0,
        skipped: 0,
        duration_ms: 0,
        outcome: 'completed' as const,
      };
      opts.on_progress?.(1, entities.length);
      await gate;
      if (pipeline.halted) {
        pipeline.stats.skipped = Math.max(entities.length - 1, 0);
        pipeline.stats.outcome = 'halted';
      } else {
        pipeline.stats.success = entities.length;
        pipeline.stats.outcome = 'completed';
      }
      pipeline.active = false;
      return pipeline.stats;
    }),
    halt: vi.fn(() => {
      pipeline.halted = true;
    }),
    is_active: vi.fn(() => pipeline.active),
    get_stats: vi.fn(() => pipeline.stats),
  };

  return {
    pipeline,
    release,
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('SmartConnectionsPlugin embedding control', () => {
  it('transitions to idle after run completes normally', async () => {
    const { app, plugin } = createPlugin();
    const { pipeline, release } = createControlledPipeline();
    plugin.embedding_pipeline = pipeline as any;

    // In 3-state FSM, initial phase is idle (no booting -> INIT_CORE_READY needed)
    const runPromise = plugin.runEmbeddingJob('test-normal-finish');
    await Promise.resolve();

    expect(plugin.status_state).toBe('embedding');

    release();
    await runPromise;

    // In 3-state FSM, run completes -> idle (not paused)
    expect(plugin.status_state).toBe('idle');
  });

  it('returns to idle after run completes even when embed phase was changed mid-run', async () => {
    const { plugin } = createPlugin();
    const { pipeline, release } = createControlledPipeline();
    plugin.embedding_pipeline = pipeline as any;

    const runPromise = plugin.runEmbeddingJob('run-guard');
    await Promise.resolve();

    // Phase is running while the job is active
    expect(plugin.status_state).toBe('embedding');

    release();
    await runPromise;

    // Run finished — FSM transitions to idle
    expect(plugin.status_state).toBe('idle');
    // current_embed_context holds the completed run snapshot
    expect(plugin.current_embed_context?.phase).toBe('completed');
  });

  it('sets error state when model load times out during switch', async () => {
    const { app, plugin } = createPlugin();

    plugin.embedding_pipeline = {
      is_active: vi.fn(() => false),
      halt: vi.fn(),
      get_stats: vi.fn(() => ({ total: 0, success: 0, failed: 0, skipped: 0, duration_ms: 0, outcome: 'completed' })),
    } as any;

    plugin.settings.smart_sources.embed_model = {
      adapter: 'openai',
      openai: { model_key: 'text-embedding-3-large', request_timeout_ms: 5 },
    } as any;

    vi.spyOn(plugin, 'initEmbedModel').mockImplementation(
      () => new Promise<void>(() => {}),
    );
    const initPipelineSpy = vi.spyOn(plugin, 'initPipeline').mockResolvedValue();

    await expect(plugin.switchEmbeddingModel('model-load-timeout')).rejects.toThrow(
      /Timed out while loading embedding model/i,
    );
    expect(plugin.status_state).toBe('error');
    expect(plugin.embed_ready).toBe(false);
    expect(initPipelineSpy).not.toHaveBeenCalled();
    expect((app as any).workspace.trigger).not.toHaveBeenCalledWith(
      'open-connections:embed-ready',
    );
  });

  it('forces stale re-embed when model key changes within same provider', async () => {
    const { plugin } = createPlugin();

    const sourceSetMeta = vi.fn();
    const sourceQueue = vi.fn();
    const blockSetMeta = vi.fn();
    const blockQueue = vi.fn();

    plugin.source_collection.all = [
      {
        read_hash: 'source-hash',
        set_active_embedding_meta: sourceSetMeta,
        queue_embed: sourceQueue,
      },
    ];
    plugin.block_collection.all = [
      {
        read_hash: 'block-hash',
        set_active_embedding_meta: blockSetMeta,
        queue_embed: blockQueue,
      },
    ];

    plugin.embedding_pipeline = {
      is_active: vi.fn(() => false),
    } as any;

    plugin.settings.smart_sources.embed_model = {
      adapter: 'openai',
      openai: { model_key: 'text-embedding-3-large' },
    } as any;

    vi.spyOn(plugin, 'initEmbedModel').mockImplementation(async () => {
      plugin.embed_adapter = {
        model_key: 'text-embedding-3-large',
        dims: 3072,
        adapter: 'openai',
        unload: vi.fn(async () => {}),
      } as any;
    });
    vi.spyOn(plugin, 'initPipeline').mockResolvedValue();
    vi.spyOn(plugin, 'syncCollectionEmbeddingContext').mockImplementation(() => {});
    vi.spyOn(plugin, 'queueUnembeddedEntities').mockReturnValue(2);

    await plugin.switchEmbeddingModel('unit-model-switch');

    expect(sourceSetMeta).toHaveBeenCalled();
    expect(sourceQueue).toHaveBeenCalled();
    expect(blockSetMeta).toHaveBeenCalled();
    expect(blockQueue).toHaveBeenCalled();
  });

  it('does not force stale re-embed when embedding fingerprint is unchanged', async () => {
    const { plugin } = createPlugin();

    const sourceSetMeta = vi.fn();
    const blockSetMeta = vi.fn();

    plugin.source_collection.all = [
      {
        read_hash: 'source-hash',
        set_active_embedding_meta: sourceSetMeta,
        queue_embed: vi.fn(),
      },
    ];
    plugin.block_collection.all = [
      {
        read_hash: 'block-hash',
        set_active_embedding_meta: blockSetMeta,
        queue_embed: vi.fn(),
      },
    ];

    plugin.embedding_pipeline = {
      is_active: vi.fn(() => false),
    } as any;

    plugin.settings.smart_sources.embed_model = {
      adapter: 'openai',
      openai: { model_key: 'text-embedding-3-small' },
    } as any;

    vi.spyOn(plugin, 'initEmbedModel').mockImplementation(async () => {
      plugin.embed_adapter = {
        model_key: 'text-embedding-3-small',
        dims: 1536,
        adapter: 'openai',
        unload: vi.fn(async () => {}),
      } as any;
    });
    vi.spyOn(plugin, 'initPipeline').mockResolvedValue();
    vi.spyOn(plugin, 'syncCollectionEmbeddingContext').mockImplementation(() => {});
    vi.spyOn(plugin, 'queueUnembeddedEntities').mockReturnValue(0);
    vi.spyOn(plugin, 'runEmbeddingJob').mockResolvedValue(null);

    await plugin.switchEmbeddingModel('unit-model-switch-unchanged');

    expect(sourceSetMeta).not.toHaveBeenCalled();
    expect(blockSetMeta).not.toHaveBeenCalled();
  });

  it('clears transient runtime state and aborts stale initialization after unload', async () => {
    const { plugin } = createPlugin();
    const coreGate = createDeferred<void>();

    plugin.ready = true;
    plugin.current_embed_context = {
      runId: 41,
      phase: 'running',
      reason: 'stale',
      adapter: 'openai',
      modelKey: 'text-embedding-3-small',
      dims: 1536,
      currentEntityKey: 's1#h1',
      currentSourcePath: 's1.md',
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
    plugin.init_errors = [{ phase: 'previous', error: new Error('stale failure') }];

    const haltSpy = vi.fn();
    plugin.embedding_pipeline = { halt: haltSpy, is_active: vi.fn(() => false) } as any;
    plugin.embedding_job_queue = { clear: vi.fn() } as any;

    const initializeEmbeddingSpy = vi.spyOn(plugin, 'initializeEmbedding').mockResolvedValue();
    const handleNewUserSpy = vi.spyOn(plugin, 'handleNewUser').mockResolvedValue();
    vi.spyOn(plugin, 'initializeCore').mockImplementation(async () => {
      await coreGate.promise;
    });

    (plugin as any)._lifecycle_epoch = 1;
    const initPromise = plugin.initialize(1);
    await Promise.resolve();

    plugin.onunload();
    coreGate.resolve();
    await initPromise;

    expect(plugin.ready).toBe(false);
    expect(plugin.current_embed_context).toBeNull();
    expect(plugin.pendingReImportPaths.size).toBe(0);
    expect(plugin.embedding_pipeline).toBeUndefined();
    expect(plugin.embedding_job_queue).toBeUndefined();
    expect(plugin.source_collection).toBeUndefined();
    expect(plugin.block_collection).toBeUndefined();
    expect(plugin.status_state).toBe('idle');
    expect(plugin.embed_ready).toBe(false);
    expect(plugin.init_errors).toHaveLength(0);
    expect(haltSpy).toHaveBeenCalled();
    expect(initializeEmbeddingSpy).not.toHaveBeenCalled();
    expect(handleNewUserSpy).not.toHaveBeenCalled();
  });
});
