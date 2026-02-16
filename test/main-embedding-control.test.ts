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
import SmartConnectionsPlugin from '../src/app/main';

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
    all: [
      { key: 's1', vec: [1, 2, 3], _queue_embed: true, should_embed: true },
      { key: 's2', vec: null, _queue_embed: true, should_embed: true },
    ],
  } as any;

  plugin.block_collection = {
    all: [],
    data_adapter: {
      save: vi.fn(async () => {}),
    },
    data_dir: '/tmp/blocks',
  } as any;

  plugin.embed_model = {
    model_key: 'text-embedding-3-small',
    adapter: { dims: 1536, adapter: 'openai' },
    unload: vi.fn(async () => {}),
  } as any;

  plugin.ensureEmbeddingKernel();

  // Pre-populate EmbedJobQueue with the source entities
  for (const entity of (plugin.source_collection as any).all) {
    plugin.embed_job_queue!.enqueue({
      entityKey: entity.key,
      contentHash: '',
      sourcePath: entity.key,
      enqueuedAt: Date.now(),
    });
  }

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
    },
    process: vi.fn(async (entities: any[], opts: any) => {
      pipeline.active = true;
      pipeline.stats = {
        total: entities.length,
        success: 0,
        failed: 0,
        skipped: 0,
        duration_ms: 0,
      };
      opts.on_progress?.(1, entities.length);
      await gate;
      if (pipeline.halted) {
        pipeline.stats.skipped = Math.max(entities.length - 1, 0);
      } else {
        pipeline.stats.success = entities.length;
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

  it('keeps newer run state when stale run finalizes', async () => {
    const { plugin } = createPlugin();
    const { pipeline, release } = createControlledPipeline();
    plugin.embedding_pipeline = pipeline as any;

    const runPromise = plugin.runEmbeddingJob('run-guard');
    await Promise.resolve();

    // In 3-state FSM, MODEL_SWITCH_REQUESTED doesn't change phase (no loading_model)
    // Phase stays 'running' until MODEL_SWITCH_SUCCEEDED fires
    plugin.dispatchKernelEvent({ type: 'MODEL_SWITCH_REQUESTED', reason: 'test' });
    plugin.active_embed_run_id = 999;

    release();
    await runPromise;

    // Stale run dispatches RUN_FINISHED to clean up FSM, transitioning to idle
    // The key invariant: active_embed_run_id stays at 999 (newer run was not overwritten)
    expect(plugin.status_state).toBe('idle');
    expect(plugin.active_embed_run_id).toBe(999);
  });

  it('sets error state when model load times out during switch', async () => {
    const { app, plugin } = createPlugin();

    plugin.embedding_pipeline = {
      is_active: vi.fn(() => false),
      halt: vi.fn(),
      get_stats: vi.fn(() => ({ total: 0, success: 0, failed: 0, skipped: 0 })),
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
      'smart-connections:embed-ready',
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
      plugin.embed_model = {
        model_key: 'text-embedding-3-large',
        adapter: { dims: 3072, adapter: 'openai' },
        unload: vi.fn(async () => {}),
      } as any;
    });
    vi.spyOn(plugin, 'initPipeline').mockResolvedValue();
    vi.spyOn(plugin, 'syncCollectionEmbeddingContext').mockImplementation(() => {});
    vi.spyOn(plugin, 'queueUnembeddedEntities').mockReturnValue(2);
    const runSpy = vi.spyOn(plugin, 'runEmbeddingJob').mockResolvedValue(null);

    await plugin.switchEmbeddingModel('unit-model-switch');

    expect(sourceSetMeta).toHaveBeenCalled();
    expect(sourceQueue).toHaveBeenCalled();
    expect(blockSetMeta).toHaveBeenCalled();
    expect(blockQueue).toHaveBeenCalled();
    expect(runSpy).toHaveBeenCalledWith('unit-model-switch');
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
      plugin.embed_model = {
        model_key: 'text-embedding-3-small',
        adapter: { dims: 1536, adapter: 'openai' },
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
});
