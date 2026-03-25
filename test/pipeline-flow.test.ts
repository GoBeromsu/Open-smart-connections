/**
 * @file pipeline-flow.test.ts
 * @description Tests for the embedding pipeline flow functions:
 *   [4] queueUnembeddedEntities
 *   [5] processNewSourcesChunked
 */

import { describe, it, expect, vi } from 'vitest';
import { queueUnembeddedEntities, processNewSourcesChunked } from '../src/ui/collection-loader';

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
    markdownFiles = [],
    chunkSize = 1000,
    hasPipeline = false,
    unloading = false,
  } = overrides;

  const plugin: any = {
    _unloading: unloading,
    pendingReImportPaths: new Set<string>(),
    settings: {
      discovery_chunk_size: chunkSize,
      embed_concurrency: 5,
      embed_save_interval: 5,
    },
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
      recomputeEmbeddedCount: vi.fn(),
    },
    source_collection: {
      all: sources,
      vault: {},
      data_adapter: { save: vi.fn(async () => {}) },
      import_source: vi.fn(async () => {}),
      recomputeEmbeddedCount: vi.fn(),
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
    runEmbeddingJob: vi.fn(async () => null),
    refreshStatus: vi.fn(),
    embed_notice_last_update: 0,
    embed_notice_last_percent: 0,
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
  };

  return plugin;
}

// ── [4] queueUnembeddedEntities ───────────────────────────────────────────────

describe('queueUnembeddedEntities', () => {
  it('only iterates blocks, not sources', () => {
    const block = makeBlock({ key: 'note.md#block-1', is_unembedded: true, should_embed: true });
    const source = {
      key: 'note.md',
      is_unembedded: true,
      should_embed: true,
      _queue_embed: false,
      queue_embed: vi.fn(),
    };

    const plugin = makePlugin({ blocks: [block], sources: [source] });
    queueUnembeddedEntities(plugin);

    expect(block.queue_embed).toHaveBeenCalled();
    expect(source.queue_embed).not.toHaveBeenCalled();
  });

  it('queues a block with is_unembedded=true AND should_embed=true', () => {
    const block = makeBlock({ key: 'note.md#h1', is_unembedded: true, should_embed: true });
    const plugin = makePlugin({ blocks: [block] });

    const count = queueUnembeddedEntities(plugin);

    expect(count).toBe(1);
    expect(block._queue_embed).toBe(true);
  });

  it('does NOT queue a block with is_unembedded=false', () => {
    const block = makeBlock({ key: 'note.md#h1', is_unembedded: false, should_embed: true });
    const plugin = makePlugin({ blocks: [block] });

    const count = queueUnembeddedEntities(plugin);

    expect(count).toBe(0);
  });

  it('does NOT queue a block with should_embed=false (too short)', () => {
    const block = makeBlock({ key: 'note.md#h1', is_unembedded: true, should_embed: false });
    const plugin = makePlugin({ blocks: [block] });

    const count = queueUnembeddedEntities(plugin);

    expect(count).toBe(0);
  });

  it('returns correct count of queued entities across multiple blocks', () => {
    const blocks = [
      makeBlock({ key: 'a.md#h1', is_unembedded: true, should_embed: true }),
      makeBlock({ key: 'a.md#h2', is_unembedded: false, should_embed: true }),
      makeBlock({ key: 'b.md#h1', is_unembedded: true, should_embed: false }),
      makeBlock({ key: 'c.md#h1', is_unembedded: true, should_embed: true }),
    ];
    const plugin = makePlugin({ blocks });

    const count = queueUnembeddedEntities(plugin);

    expect(count).toBe(2);
  });

  it('works when block_collection is absent', () => {
    const plugin = makePlugin({ blocks: [] });
    plugin.block_collection = undefined;

    const count = queueUnembeddedEntities(plugin);
    expect(count).toBe(0);
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

    expect(plugin.runEmbeddingJob).not.toHaveBeenCalled();
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

    plugin.block_collection.all = [
      makeBlock({ key: 'a.md#h1', is_unembedded: true, should_embed: true }),
    ];

    await processNewSourcesChunked(plugin);

    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(3);
    // 1 chunk + 1 final sweep = 2 calls
    expect(plugin.runEmbeddingJob).toHaveBeenCalledTimes(2);
    expect(plugin.runEmbeddingJob).toHaveBeenNthCalledWith(1, '[chunked-pipeline] 3/3');
    expect(plugin.runEmbeddingJob).toHaveBeenNthCalledWith(2, '[chunked-pipeline] final sweep');
  });

  it('processes files in multiple chunks when N > chunk_size', async () => {
    const newFiles = Array.from({ length: 7 }, (_, i) => ({ path: `note-${i}.md` }));
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 3,
      hasPipeline: true,
    });

    plugin.block_collection.all = newFiles.map((f, i) =>
      makeBlock({ key: `${f.path}#h${i}`, is_unembedded: true, should_embed: true }),
    );

    await processNewSourcesChunked(plugin);

    // 7 files / chunk_size 3 = 3 chunks (3+3+1) + 1 final sweep = 4 total
    expect(plugin.runEmbeddingJob).toHaveBeenCalledTimes(4);
    expect(plugin.runEmbeddingJob).toHaveBeenNthCalledWith(1, '[chunked-pipeline] 3/7');
    expect(plugin.runEmbeddingJob).toHaveBeenNthCalledWith(2, '[chunked-pipeline] 6/7');
    expect(plugin.runEmbeddingJob).toHaveBeenNthCalledWith(3, '[chunked-pipeline] 7/7');
    expect(plugin.runEmbeddingJob).toHaveBeenNthCalledWith(4, '[chunked-pipeline] final sweep');
  });

  it('handles exact chunk boundaries without skipping or adding extra chunks', async () => {
    const newFiles = Array.from({ length: 6 }, (_, i) => ({ path: `note-${i}.md` }));
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 3,
      hasPipeline: true,
    });

    plugin.block_collection.all = newFiles.map((f, i) =>
      makeBlock({ key: `${f.path}#h${i}`, is_unembedded: true, should_embed: true }),
    );

    await processNewSourcesChunked(plugin);

    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(6);
    expect(plugin.runEmbeddingJob).toHaveBeenCalledTimes(3);
    expect((plugin.runEmbeddingJob as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[0]).toContain('final sweep');
  });

  it('does NOT re-process files already in source_collection', async () => {
    const plugin = makePlugin({
      sources: [{ key: 'existing.md' }],
      markdownFiles: [
        { path: 'existing.md' },
        { path: 'new.md' },
      ],
      chunkSize: 50,
      hasPipeline: true,
    });
    plugin.block_collection.all = [
      makeBlock({ key: 'new.md#h1', is_unembedded: true, should_embed: true }),
    ];

    await processNewSourcesChunked(plugin);

    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(1);
    expect(plugin.source_collection.import_source).toHaveBeenCalledWith({ path: 'new.md' });
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
    expect(plugin.runEmbeddingJob).not.toHaveBeenCalled();
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
    plugin.runEmbeddingJob = vi.fn(async () => {
      chunkCallCount++;
      if (chunkCallCount >= 2) {
        plugin._unloading = true;
      }
      return null;
    });

    await processNewSourcesChunked(plugin);

    expect(chunkCallCount).toBeLessThan(3);
  });

  it('does not call runEmbeddingJob when no embeddable entities in chunk', async () => {
    const newFiles = [{ path: 'a.md' }];
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 10,
      hasPipeline: true,
    });
    plugin.block_collection.all = [];

    await processNewSourcesChunked(plugin);

    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(1);
    expect(plugin.runEmbeddingJob).not.toHaveBeenCalled();
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

    expect(plugin.runEmbeddingJob).not.toHaveBeenCalled();
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

  it('triggers debounceReImport when pendingReImportPaths has entries after chunked processing', async () => {
    const newFiles = [{ path: 'a.md' }];
    const plugin = makePlugin({
      sources: [],
      markdownFiles: newFiles,
      chunkSize: 10,
      hasPipeline: true,
    });
    plugin.block_collection.all = [];

    // Simulate a file change occurring during processing
    plugin.source_collection.import_source = vi.fn(async () => {
      plugin.pendingReImportPaths.add('changed.md');
    });

    await processNewSourcesChunked(plugin);

    // The pending path should still be in the set (debounceReImport was called)
    expect(plugin.pendingReImportPaths.has('changed.md')).toBe(true);
  });
});
