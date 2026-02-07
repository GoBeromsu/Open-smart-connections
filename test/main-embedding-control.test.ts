/**
 * @file main-embedding-control.test.ts
 * @description Regression tests for embedding run control and model switch flow
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
    embed_queue: [{ id: 's1' }, { id: 's2' }],
    data_adapter: {
      save: vi.fn(async () => {}),
    },
    data_dir: '/tmp/sources',
    size: 2,
    all: [{ vec: [1, 2, 3] }, { vec: null }],
  } as any;

  plugin.block_collection = {
    embed_queue: [],
    data_adapter: {
      save: vi.fn(async () => {}),
    },
    data_dir: '/tmp/blocks',
  } as any;

  plugin.embed_model = {
    model_key: 'text-embedding-3-small',
    adapter: { dims: 1536 },
  } as any;

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
  it('transitions to paused only after stop completes', async () => {
    const { app, plugin } = createPlugin();
    const { pipeline, release } = createControlledPipeline();
    plugin.embedding_pipeline = pipeline as any;

    const runPromise = plugin.runEmbeddingJob('test-stop-flow');
    await Promise.resolve();

    expect(plugin.status_state).toBe('embedding');

    const stopAccepted = plugin.requestEmbeddingStop('unit-test-stop');
    expect(stopAccepted).toBe(true);
    expect(plugin.status_state).toBe('stopping');

    release();
    await runPromise;

    expect(plugin.status_state).toBe('paused');
    expect(plugin.current_embed_context?.phase).toBe('paused');
    expect((app as any).workspace.trigger).toHaveBeenCalledWith(
      'smart-connections:embed-progress',
      expect.objectContaining({ done: true, phase: 'paused' }),
    );
  });

  it('keeps newer run state when stale run finalizes', async () => {
    const { plugin } = createPlugin();
    const { pipeline, release } = createControlledPipeline();
    plugin.embedding_pipeline = pipeline as any;

    const runPromise = plugin.runEmbeddingJob('run-guard');
    await Promise.resolve();

    plugin.status_state = 'loading_model';
    plugin.active_embed_run_id = 999;

    release();
    await runPromise;

    expect(plugin.status_state).toBe('loading_model');
    expect(plugin.active_embed_run_id).toBe(999);
  });

  it('sets error state when model switch cannot stop previous run', async () => {
    const { app, plugin } = createPlugin();

    plugin.embedding_pipeline = {
      is_active: vi.fn(() => true),
      halt: vi.fn(),
      get_stats: vi.fn(() => ({ total: 0, success: 0, failed: 0, skipped: 0 })),
    } as any;

    vi.spyOn(plugin, 'waitForEmbeddingToStop').mockResolvedValue(false);
    const initSpy = vi.spyOn(plugin, 'initEmbedModel').mockResolvedValue();

    await expect(plugin.switchEmbeddingModel('switch-timeout-test')).rejects.toThrow(
      /Failed to stop previous embedding run/i,
    );

    expect(plugin.status_state).toBe('error');
    expect(plugin.embed_ready).toBe(false);
    expect(initSpy).not.toHaveBeenCalled();
    expect((app as any).workspace.trigger).not.toHaveBeenCalledWith(
      'smart-connections:embed-ready',
    );
  });
});
