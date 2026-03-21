/**
 * @file pipeline-flow.test.ts
 * @description Tests for the embedding pipeline flow functions:
 *   [4] queueUnembeddedEntities
 *   [5] processNewSourcesChunked
 *   [6] handleRunCompleted (via runEmbeddingJobImmediate)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { App } from 'obsidian';
import SmartConnectionsPlugin from '../src/main';
import { queueUnembeddedEntities, processNewSourcesChunked } from '../src/ui/collection-loader';
import { EmbedJobQueue } from '../src/domain/embedding/embed-job-queue';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeBlock(opts: {
  key: string;
  is_unembedded?: boolean;
  should_embed?: boolean;
  read_hash?: string;
}): any {
  const { key, is_unembedded = true, should_embed = true, read_hash = 'hash-' + key } = opts;
  return {
    key,
    is_unembedded,
    should_embed,
    read_hash,
    _queue_embed: false,
    queue_embed: vi.fn(function (this: any) {
      // Only set _queue_embed when the entity is embeddable
      if (this.is_unembedded && this.should_embed) {
        this._queue_embed = true;
      }
    }),
  };
}

function makeSource(opts: { key: string; is_unembedded?: boolean; should_embed?: boolean }): any {
  const { key, is_unembedded = false, should_embed = false } = opts;
  return {
    key,
    is_unembedded,
    should_embed,
    _queue_embed: false,
    queue_embed: vi.fn(function (this: any) {
      if (this.is_unembedded && this.should_embed) {
        this._queue_embed = true;
      }
    }),
  };
}

function makePlugin(overrides: Partial<{
  blocks: any[];
  sources: any[];
  knownSourcePaths: string[];
  markdownFiles: any[];
  chunkSize: number;
  hasPipeline: boolean;
  unloading: boolean;
}> = {}): any {
  const {
    blocks = [],
    sources = [],
    knownSourcePaths = [],
    markdownFiles = [],
    chunkSize = 1000,
    hasPipeline = false,
    unloading = false,
  } = overrides;

  const queue = new EmbedJobQueue();

  const plugin: any = {
    _unloading: unloading,
    settings: {
      discovery_chunk_size: chunkSize,
      embed_concurrency: 5,
      embed_save_interval: 5,
    },
    embed_job_queue: queue,
    embedding_pipeline: hasPipeline ? {
      is_active: vi.fn(() => false),
      process: vi.fn(async () => ({
        total: 0,
        success: 0,
        failed: 0,
        skipped: 0,
        duration_ms: 0,
      })),
      halt: vi.fn(),
    } : undefined,
    block_collection: {
      all: blocks,
      data_adapter: { save: vi.fn(async () => {}) },
    },
    source_collection: {
      all: sources,
      vault: {}, // truthy — needed for processNewSourcesChunked guard
      data_adapter: { save: vi.fn(async () => {}) },
      import_source: vi.fn(async () => {}),
    },
    app: {
      vault: {
        getMarkdownFiles: vi.fn(() => markdownFiles),
      },
      workspace: {
        trigger: vi.fn(),
        getLeavesOfType: vi.fn(() => []),
      },
    },
    notices: {
      show: vi.fn(),
      remove: vi.fn(),
    },
    // Plugin methods wired in main.ts
    runEmbeddingJobImmediate: vi.fn(async () => null),
    dispatchKernelEvent: vi.fn(),
    refreshStatus: vi.fn(),
    embed_notice_last_update: 0,
    embed_notice_last_percent: 0,
  };

  return plugin;
}

// ── [4] queueUnembeddedEntities ───────────────────────────────────────────────

describe('queueUnembeddedEntities', () => {
  it('only iterates blocks, not sources', () => {
    const block = makeBlock({ key: 'note.md#block-1', is_unembedded: true, should_embed: true });
    const source = makeSource({ key: 'note.md', is_unembedded: true, should_embed: true });

    const plugin = makePlugin({ blocks: [block], sources: [source] });
    queueUnembeddedEntities(plugin);

    // Block's queue_embed should be called
    expect(block.queue_embed).toHaveBeenCalled();
    // Source's queue_embed should NOT be called (sources are skipped)
    expect(source.queue_embed).not.toHaveBeenCalled();
  });

  it('queues a block with is_unembedded=true AND should_embed=true', () => {
    const block = makeBlock({ key: 'note.md#h1', is_unembedded: true, should_embed: true });
    const plugin = makePlugin({ blocks: [block] });

    const count = queueUnembeddedEntities(plugin);

    expect(count).toBe(1);
    expect(plugin.embed_job_queue.size()).toBe(1);
    expect(plugin.embed_job_queue.toArray()[0].entityKey).toBe('note.md#h1');
  });

  it('does NOT queue a block with is_unembedded=false', () => {
    const block = makeBlock({ key: 'note.md#h1', is_unembedded: false, should_embed: true });
    const plugin = makePlugin({ blocks: [block] });

    const count = queueUnembeddedEntities(plugin);

    expect(count).toBe(0);
    expect(plugin.embed_job_queue.size()).toBe(0);
  });

  it('does NOT queue a block with should_embed=false (too short)', () => {
    // When should_embed=false, queue_embed() won't set _queue_embed=true
    const block = makeBlock({ key: 'note.md#h1', is_unembedded: true, should_embed: false });
    const plugin = makePlugin({ blocks: [block] });

    const count = queueUnembeddedEntities(plugin);

    expect(count).toBe(0);
    expect(plugin.embed_job_queue.size()).toBe(0);
  });

  it('returns correct count of queued entities across multiple blocks', () => {
    const blocks = [
      makeBlock({ key: 'a.md#h1', is_unembedded: true, should_embed: true }),
      makeBlock({ key: 'a.md#h2', is_unembedded: false, should_embed: true }),   // not queued
      makeBlock({ key: 'b.md#h1', is_unembedded: true, should_embed: false }),   // not queued
      makeBlock({ key: 'c.md#h1', is_unembedded: true, should_embed: true }),
    ];
    const plugin = makePlugin({ blocks });

    const count = queueUnembeddedEntities(plugin);

    expect(count).toBe(2);
    expect(plugin.embed_job_queue.size()).toBe(2);
  });

  it('adds entries to embed_job_queue with correct entityKey and sourcePath', () => {
    const block = makeBlock({ key: 'folder/note.md#heading', is_unembedded: true, should_embed: true });
    const plugin = makePlugin({ blocks: [block] });

    queueUnembeddedEntities(plugin);

    const jobs = plugin.embed_job_queue.toArray();
    expect(jobs).toHaveLength(1);
    expect(jobs[0].entityKey).toBe('folder/note.md#heading');
    expect(jobs[0].sourcePath).toBe('folder/note.md');
  });

  it('works when block_collection is absent', () => {
    const plugin = makePlugin({ blocks: [] });
    plugin.block_collection = undefined;

    const count = queueUnembeddedEntities(plugin);
    expect(count).toBe(0);
  });

  it('works when embed_job_queue is absent', () => {
    const block = makeBlock({ key: 'a.md#h1', is_unembedded: true, should_embed: true });
    const plugin = makePlugin({ blocks: [block] });
    plugin.embed_job_queue = undefined;

    // Should not throw, just silently skip enqueue
    expect(() => queueUnembeddedEntities(plugin)).not.toThrow();
  });
});

// ── [5] processNewSourcesChunked ──────────────────────────────────────────────

describe('processNewSourcesChunked', () => {
  it('returns immediately with 0 new files — no embedding called', async () => {
    const plugin = makePlugin({
      sources: [{ key: 'existing.md' }],
      markdownFiles: [{ path: 'existing.md' }],
      hasPipeline: true,
    });

    await processNewSourcesChunked(plugin);

    expect(plugin.runEmbeddingJobImmediate).not.toHaveBeenCalled();
    expect(plugin.source_collection.import_source).not.toHaveBeenCalled();
  });

  it('processes all files in 1 chunk when N < chunk_size', async () => {
    const newFiles = [
      { path: 'a.md' },
      { path: 'b.md' },
      { path: 'c.md' },
    ];
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 50,
      hasPipeline: true,
    });

    // Make runEmbeddingJobImmediate queue a block so it triggers
    plugin.block_collection.all = [
      makeBlock({ key: 'a.md#h1', is_unembedded: true, should_embed: true }),
    ];

    await processNewSourcesChunked(plugin);

    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(3);
    // 1 chunk + 1 final sweep = 2 calls
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenCalledTimes(2);
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenNthCalledWith(1, '[chunked-pipeline] 3/3');
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenNthCalledWith(2, '[chunked-pipeline] final sweep');
  });

  it('processes files in multiple chunks when N > chunk_size', async () => {
    const newFiles = Array.from({ length: 7 }, (_, i) => ({ path: `note-${i}.md` }));
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 3,
      hasPipeline: true,
    });

    // Provide embeddable blocks so chunks trigger embedding
    plugin.block_collection.all = newFiles.map((f, i) =>
      makeBlock({ key: `${f.path}#h${i}`, is_unembedded: true, should_embed: true }),
    );

    await processNewSourcesChunked(plugin);

    // 7 files / chunk_size 3 = 3 chunks (3+3+1) + 1 final sweep = 4 total
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenCalledTimes(4);
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenNthCalledWith(1, '[chunked-pipeline] 3/7');
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenNthCalledWith(2, '[chunked-pipeline] 6/7');
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenNthCalledWith(3, '[chunked-pipeline] 7/7');
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenNthCalledWith(4, '[chunked-pipeline] final sweep');
  });

  it('does NOT re-process files already in source_collection', async () => {
    const plugin = makePlugin({
      sources: [{ key: 'existing.md' }],
      markdownFiles: [
        { path: 'existing.md' },  // already known
        { path: 'new.md' },        // new
      ],
      chunkSize: 50,
      hasPipeline: true,
    });
    plugin.block_collection.all = [
      makeBlock({ key: 'new.md#h1', is_unembedded: true, should_embed: true }),
    ];

    await processNewSourcesChunked(plugin);

    // import_source should only be called for the new file
    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(1);
    expect(plugin.source_collection.import_source).toHaveBeenCalledWith({ path: 'new.md' });
  });

  it('calls runEmbeddingJobImmediate with [chunked-pipeline] prefix per chunk', async () => {
    const newFiles = [{ path: 'a.md' }, { path: 'b.md' }];
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 10,
      hasPipeline: true,
    });
    plugin.block_collection.all = [
      makeBlock({ key: 'a.md#h1', is_unembedded: true, should_embed: true }),
    ];

    await processNewSourcesChunked(plugin);

    const calls = (plugin.runEmbeddingJobImmediate as ReturnType<typeof vi.fn>).mock.calls;
    // 1 chunk + 1 final sweep = 2 calls, both with [chunked-pipeline] prefix
    expect(calls.length).toBe(2);
    expect(calls[0][0]).toMatch(/^\[chunked-pipeline\]/);
    expect(calls[1][0]).toMatch(/^\[chunked-pipeline\]/);
  });

  it('stops when plugin._unloading = true before first chunk', async () => {
    const plugin = makePlugin({
      sources: [],
      markdownFiles: [{ path: 'a.md' }],
      chunkSize: 10,
      hasPipeline: true,
      unloading: true,
    });

    await processNewSourcesChunked(plugin);

    expect(plugin.source_collection.import_source).not.toHaveBeenCalled();
    expect(plugin.runEmbeddingJobImmediate).not.toHaveBeenCalled();
  });

  it('stops mid-loop when plugin._unloading becomes true during processing', async () => {
    const newFiles = Array.from({ length: 6 }, (_, i) => ({ path: `note-${i}.md` }));
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 2,
      hasPipeline: true,
    });
    plugin.block_collection.all = newFiles.map((f, i) =>
      makeBlock({ key: `${f.path}#h${i}`, is_unembedded: true, should_embed: true }),
    );

    let chunkCallCount = 0;
    plugin.runEmbeddingJobImmediate = vi.fn(async () => {
      chunkCallCount++;
      if (chunkCallCount >= 2) {
        plugin._unloading = true;
      }
      return null;
    });

    await processNewSourcesChunked(plugin);

    // Should have stopped before processing all 3 chunks
    expect(chunkCallCount).toBeLessThan(3);
  });

  it('CRITICAL: terminates after exactly 3 chunks with 150 files and chunk_size=50', async () => {
    const newFiles = Array.from({ length: 150 }, (_, i) => ({ path: `note-${i}.md` }));
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 50,
      hasPipeline: true,
    });
    plugin.block_collection.all = newFiles.map((f, i) =>
      makeBlock({ key: `${f.path}#h${i}`, is_unembedded: true, should_embed: true }),
    );

    await processNewSourcesChunked(plugin);

    // 3 chunk runs + 1 final sweep = 4 total
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenCalledTimes(4);
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenNthCalledWith(1, '[chunked-pipeline] 50/150');
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenNthCalledWith(2, '[chunked-pipeline] 100/150');
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenNthCalledWith(3, '[chunked-pipeline] 150/150');
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenNthCalledWith(4, '[chunked-pipeline] final sweep');
    // All 150 files imported
    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(150);
  });

  it('does not call runEmbeddingJobImmediate when no embeddable entities in chunk', async () => {
    const newFiles = [{ path: 'a.md' }];
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 10,
      hasPipeline: true,
    });
    // No embeddable blocks
    plugin.block_collection.all = [];

    await processNewSourcesChunked(plugin);

    // Import runs but no embedding triggered because queue is empty
    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(1);
    expect(plugin.runEmbeddingJobImmediate).not.toHaveBeenCalled();
  });

  it('skips embedding when embedding_pipeline is not set', async () => {
    const newFiles = [{ path: 'a.md' }];
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 10,
      hasPipeline: false,
    });
    plugin.block_collection.all = [
      makeBlock({ key: 'a.md#h1', is_unembedded: true, should_embed: true }),
    ];

    await processNewSourcesChunked(plugin);

    // Even with embeddable blocks, no embedding without pipeline
    expect(plugin.runEmbeddingJobImmediate).not.toHaveBeenCalled();
  });

  it('returns early when source_collection has no vault', async () => {
    const plugin = makePlugin({
      sources: [],
      markdownFiles: [{ path: 'a.md' }],
    });
    plugin.source_collection.vault = undefined;

    await processNewSourcesChunked(plugin);

    expect(plugin.source_collection.import_source).not.toHaveBeenCalled();
  });
});

// ── [6] handleRunCompleted (via runEmbeddingJobImmediate) ─────────────────────

describe('handleRunCompleted via runEmbeddingJobImmediate', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function buildPluginForOrchestrator(blockKeys: string[] = ['note.md#h1']): SmartConnectionsPlugin {
    const app = new App();
    (app as any).workspace.trigger = vi.fn();
    (app as any).workspace.getLeavesOfType = vi.fn(() => []);

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
      embed_concurrency: 5,
      embed_save_interval: 5,
    } as any;

    plugin.source_collection = {
      data_adapter: { save: vi.fn(async () => {}) },
      data_dir: '/tmp/sources',
      all: [],
    } as any;

    const blocks = blockKeys.map(key => ({
      key,
      _queue_embed: true,
      should_embed: true,
      is_unembedded: false,
      queue_embed: vi.fn(),
    }));

    plugin.block_collection = {
      all: blocks,
      data_adapter: { save: vi.fn(async () => {}) },
      data_dir: '/tmp/blocks',
    } as any;

    plugin.embed_adapter = {
      model_key: 'text-embedding-3-small',
      dims: 1536,
      adapter: 'openai',
      unload: vi.fn(async () => {}),
    } as any;

    plugin.ensureEmbeddingKernel();

    for (const key of blockKeys) {
      plugin.embed_job_queue!.enqueue({
        entityKey: key,
        contentHash: '',
        sourcePath: key.split('#')[0],
        enqueuedAt: Date.now(),
      });
    }

    return plugin;
  }

  function makeInstantPipeline(blockKeys: string[]) {
    return {
      active: false,
      is_active: vi.fn(() => false),
      halt: vi.fn(),
      process: vi.fn(async (_entities: any[], _opts: any) => ({
        total: blockKeys.length,
        success: blockKeys.length,
        failed: 0,
        skipped: 0,
        duration_ms: 10,
      })),
    };
  }

  it('for chunked run: does NOT clear embed_job_queue', async () => {
    const blockKeys = ['a.md#h1', 'b.md#h1'];
    const plugin = buildPluginForOrchestrator(blockKeys);
    plugin.embedding_pipeline = makeInstantPipeline(blockKeys) as any;

    // Add extra items beyond what's being processed
    plugin.embed_job_queue!.enqueue({
      entityKey: 'c.md#h1',
      contentHash: '',
      sourcePath: 'c.md',
      enqueuedAt: Date.now(),
    });

    await plugin.runEmbeddingJobImmediate('[chunked-pipeline] 50/150');

    // Queue not wiped — extra item c.md#h1 survives
    const remaining = plugin.embed_job_queue!.toArray().map(j => j.entityKey);
    expect(remaining).toContain('c.md#h1');
  });

  it('for chunked run: does NOT call queueUnembeddedEntities', async () => {
    const plugin = buildPluginForOrchestrator(['note.md#h1']);
    const queueSpy = vi.spyOn(plugin, 'queueUnembeddedEntities');
    plugin.embedding_pipeline = makeInstantPipeline(['note.md#h1']) as any;

    await plugin.runEmbeddingJobImmediate('[chunked-pipeline] 10/50');

    expect(queueSpy).not.toHaveBeenCalled();
  });

  it('for normal run: calls queueUnembeddedEntities after completion', async () => {
    const plugin = buildPluginForOrchestrator(['note.md#h1']);
    const queueSpy = vi.spyOn(plugin, 'queueUnembeddedEntities').mockReturnValue(0);
    plugin.embedding_pipeline = makeInstantPipeline(['note.md#h1']) as any;

    await plugin.runEmbeddingJobImmediate('Normal run');

    expect(queueSpy).toHaveBeenCalled();
  });

  it('for normal run: clears embed_job_queue after completion', async () => {
    const blockKeys = ['note.md#h1'];
    const plugin = buildPluginForOrchestrator(blockKeys);
    plugin.embedding_pipeline = makeInstantPipeline(blockKeys) as any;

    // Spy on the queue's clear method
    const clearSpy = vi.spyOn(plugin.embed_job_queue!, 'clear');

    await plugin.runEmbeddingJobImmediate('Normal run');

    expect(clearSpy).toHaveBeenCalled();
  });

  it('for normal run: scheduleStaleRetry fires when unresolved > 0', async () => {
    const blockKeys = ['note.md#h1'];
    const plugin = buildPluginForOrchestrator(blockKeys);
    plugin.embedding_pipeline = makeInstantPipeline(blockKeys) as any;

    vi.spyOn(plugin, 'queueUnembeddedEntities').mockReturnValue(3);
    const enqueueSpy = vi.spyOn(plugin, 'enqueueEmbeddingJob').mockResolvedValue(null as any);

    await plugin.runEmbeddingJobImmediate('Normal run');

    // Advance timers to allow the void promise to schedule
    await vi.runAllTimersAsync();

    const retryCalls = enqueueSpy.mock.calls.filter(c => c[0]?.key === 'RUN_EMBED_BATCH_RETRY');
    expect(retryCalls.length).toBeGreaterThan(0);
    expect(retryCalls[0]![0].type).toBe('RUN_EMBED_BATCH');
  });

  it('for chunked run: scheduleStaleRetry does NOT fire', async () => {
    const blockKeys = ['note.md#h1'];
    const plugin = buildPluginForOrchestrator(blockKeys);
    plugin.embedding_pipeline = makeInstantPipeline(blockKeys) as any;

    const enqueueSpy = vi.spyOn(plugin, 'enqueueEmbeddingJob').mockResolvedValue(null as any);

    await plugin.runEmbeddingJobImmediate('[chunked-pipeline] 50/150');
    await vi.runAllTimersAsync();

    // For chunked runs, unresolvedAfterRun is forced to 0, so retry is skipped
    const retryCalls = enqueueSpy.mock.calls.filter(
      c => c[0]?.key === 'RUN_EMBED_BATCH_RETRY',
    );
    expect(retryCalls).toHaveLength(0);
  });
});
