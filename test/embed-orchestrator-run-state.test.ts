import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import SmartConnectionsPlugin from '../src/main';
import { runEmbeddingJobNow } from '../src/ui/embed-orchestrator';
import type { EmbedQueueStats } from '../src/domain/embedding-pipeline';

function createPlugin() {
  const app = new App();
  (app as any).workspace.trigger = vi.fn();
  (app as any).workspace.getLeavesOfType = vi.fn(() => []);

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
    embed_concurrency: 2,
    embed_save_interval: 1,
  } as any;

  plugin.source_collection = {
    data_adapter: {
      save: vi.fn(async () => {}),
    },
    data_dir: '/tmp/sources',
    size: 1,
    all: [],
    recomputeEmbeddedCount: vi.fn(),
  } as any;

  plugin.block_collection = {
    all: [
      { key: 's1#h1', vec: null, _queue_embed: true, should_embed: true },
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

  plugin.notices.show = vi.fn();
  plugin.notices.remove = vi.fn();
  vi.spyOn(plugin, 'refreshStatus').mockImplementation(() => {});
  vi.spyOn(plugin, 'logEmbed').mockImplementation(() => {});
  vi.spyOn(plugin, 'enqueueEmbeddingJob').mockResolvedValue(null as any);

  return { app, plugin };
}

function makeStats(overrides: Partial<EmbedQueueStats> = {}): EmbedQueueStats {
  return {
    total: 1,
    success: 1,
    failed: 0,
    skipped: 0,
    duration_ms: 1,
    outcome: 'completed',
    ...overrides,
  };
}

describe('runEmbeddingJobNow', () => {
  it('keeps a failed pipeline run in error state with a failed snapshot', async () => {
    const { plugin } = createPlugin();

    plugin.embedding_pipeline = {
      is_active: vi.fn(() => false),
      process: vi.fn(async () => makeStats({
        success: 0,
        failed: 1,
        outcome: 'failed',
        error: 'save boom',
      })),
    } as any;

    const stats = await runEmbeddingJobNow(plugin, 'unit-failed-run');

    expect(stats?.outcome).toBe('failed');
    expect(plugin.status_state).toBe('error');
    expect(plugin.current_embed_context?.phase).toBe('failed');
    expect(plugin.current_embed_context?.error).toBe('save boom');
    expect(plugin.notices.show).toHaveBeenCalledWith('embedding_failed');
  });

  it('keeps a halted pipeline run distinct from completed', async () => {
    const { plugin } = createPlugin();
    vi.spyOn(plugin, 'queueUnembeddedEntities').mockReturnValue(3);

    plugin.embedding_pipeline = {
      is_active: vi.fn(() => false),
      process: vi.fn(async () => makeStats({
        total: 4,
        success: 1,
        skipped: 3,
        outcome: 'halted',
      })),
    } as any;

    const stats = await runEmbeddingJobNow(plugin, 'unit-halted-run');

    expect(stats?.outcome).toBe('halted');
    expect(plugin.status_state).toBe('idle');
    expect(plugin.current_embed_context?.phase).toBe('halted');
    expect(plugin.current_embed_context?.followupQueued).toBe(false);
    expect(plugin.enqueueEmbeddingJob).not.toHaveBeenCalled();
  });

  it('schedules a deterministic follow-up run when work remains after completion', async () => {
    const { plugin } = createPlugin();
    vi.spyOn(plugin, 'queueUnembeddedEntities').mockReturnValue(2);

    plugin.embedding_pipeline = {
      is_active: vi.fn(() => false),
      process: vi.fn(async () => makeStats({
        total: 1,
        success: 1,
        outcome: 'completed',
      })),
    } as any;

    const stats = await runEmbeddingJobNow(plugin, 'unit-followup-run');

    expect(stats?.outcome).toBe('completed');
    expect(plugin.status_state).toBe('idle');
    expect(plugin.current_embed_context?.phase).toBe('followup-required');
    expect(plugin.current_embed_context?.followupQueued).toBe(true);
    expect(plugin.enqueueEmbeddingJob).toHaveBeenCalledTimes(1);
    expect((plugin.enqueueEmbeddingJob as any).mock.calls[0][0]).toMatchObject({
      type: 'RUN_EMBED_FOLLOWUP',
      priority: 31,
    });
  });
});
