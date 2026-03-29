/**
 * @file collection-loader-yield.test.ts
 * @description TDD tests for freeze-fix behaviours in collection-loader.ts.
 *
 * CURRENT STATE (red phase): these tests describe desired behaviour that does
 * not yet exist.  They are expected to fail until the implementation is fixed.
 *
 * Desired behaviours:
 *   loadCollections()
 *     - yields to the event loop (via setTimeout(0) or equivalent) at least once
 *       during the source-to-file mapping loop when the collection is non-trivial
 *
 *   detectStaleSourcesOnStartup()
 *     - processes sources in chunks ≤ CHUNK_SIZE, not all in one synchronous pass
 *     - calls a yield between chunks
 *
 *   processNewSourcesChunked()
 *     - uses chunk size ≤ 100 (not the current default of 1000)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import {
  loadCollections,
  detectStaleSourcesOnStartup,
  processNewSourcesChunked,
} from '../../src/ui/collection-loader';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeTFile(path: string, mtime = 1000): any {
  const f = Object.create(TFile.prototype);
  f.path = path;
  f.extension = 'md';
  f.stat = { mtime, size: 500 };
  return f;
}

function makeSource(key: string, storedMtime = 1000): any {
  return {
    key,
    data: { last_read: { mtime: storedMtime } },
    vault: undefined as any,
    file: undefined as any,
  };
}

function makePlugin(
  sources: any[],
  vaultFiles: Record<string, any> = {},
  opts: { chunkSize?: number } = {},
): any {
  return {
    _unloading: false,
    pendingReImportPaths: new Set<string>(),
    settings: {
      smart_sources: { folder_exclusions: '', file_exclusions: '' },
      re_import_wait_time: 13,
      discovery_chunk_size: opts.chunkSize ?? 1000,
    },
    source_collection: {
      all: sources,
      vault: {},
      loaded: false,
      _initializing: true,
      size: sources.length,
      embeddedCount: 0,
      embed_model_key: 'test-model',
      recomputeEmbeddedCount: vi.fn(),
      data_adapter: {
        load: vi.fn(),
        save: vi.fn(async () => {}),
      },
      import_source: vi.fn(async () => {}),
      delete: vi.fn(),
    },
    block_collection: {
      all: [],
      loaded: false,
      size: 0,
      embeddedCount: 0,
      recomputeEmbeddedCount: vi.fn(),
      delete_source_blocks: vi.fn(),
      data_adapter: {
        load: vi.fn(),
        save: vi.fn(async () => {}),
      },
    },
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => vaultFiles[path] ?? null,
        getMarkdownFiles: () => [],
        configDir: '.obsidian',
        adapter: {},
        getName: () => 'test-vault',
      },
      metadataCache: {},
      workspace: { trigger: vi.fn() },
    },
    embed_adapter: undefined,
    manifest: { id: 'open-connections' },
    notices: { show: vi.fn() },
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    refreshStatus: vi.fn(),
    runEmbeddingJob: vi.fn(async () => {}),
    enqueueEmbeddingJob: vi.fn(async () => {}),
    queueUnembeddedEntities: vi.fn(() => 0),
    embedding_pipeline: {},
  };
}

// ── loadCollections: yields during source-to-file mapping ─────────────────────

describe('loadCollections — yield during source-to-file mapping', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('yields to the event loop at least once when mapping ≥ 100 sources', async () => {
    const sources = Array.from({ length: 150 }, (_, i) => makeSource(`note-${i}.md`));
    const vaultFiles: Record<string, any> = {};
    sources.forEach(s => { vaultFiles[s.key] = makeTFile(s.key); });

    const plugin = makePlugin(sources, vaultFiles);

    // Track setTimeout calls (which is how a yield-to-event-loop is typically done)
    const queueMicrotaskSpy = vi.spyOn(globalThis, 'queueMicrotask');

    const loadPromise = loadCollections(plugin as any);
    await vi.runAllTimersAsync();
    await loadPromise;

    // At least one zero-delay setTimeout must have been scheduled during the loop
    expect(queueMicrotaskSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('does not yield when source collection is empty', async () => {
    const plugin = makePlugin([], {});
    const queueMicrotaskSpy = vi.spyOn(globalThis, 'queueMicrotask');

    const loadPromise = loadCollections(plugin as any);
    await vi.runAllTimersAsync();
    await loadPromise;

    expect(queueMicrotaskSpy.mock.calls.length).toBe(0);
  });
});

// ── detectStaleSourcesOnStartup: chunked processing ───────────────────────────

describe('detectStaleSourcesOnStartup — chunked processing', () => {
  /**
   * The fix must make detectStaleSourcesOnStartup async and process sources
   * in chunks, yielding between each chunk so it doesn't block for O(n) calls.
   *
   * We verify this by checking that:
   *   1. The function returns a Promise.
   *   2. When given N sources with a chunk size of K, at least floor(N/K) - 1
   *      yields (setTimeout(0)) are scheduled.
   */
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('returns a thenable (Promise) not a plain number', () => {
    const plugin = makePlugin([], {});
    const result = detectStaleSourcesOnStartup(plugin as any);
    // The current implementation returns a plain number — this should fail until async
    expect(result).toBeInstanceOf(Promise);
  });

  it('yields between chunks when processing a large number of sources', async () => {
    // 300 sources — if chunk size is ≤ 100 we expect ≥ 2 yields
    const vaultFiles: Record<string, any> = {};
    const sources = Array.from({ length: 300 }, (_, i) => {
      const f = makeTFile(`note-${i}.md`, 1000);
      vaultFiles[`note-${i}.md`] = f;
      return makeSource(`note-${i}.md`, 1000);
    });
    // Simulate loadCollections having set source.file
    sources.forEach(s => { s.file = vaultFiles[s.key]; });

    const plugin = makePlugin(sources, vaultFiles);
    const queueMicrotaskSpy = vi.spyOn(globalThis, 'queueMicrotask');

    const detectPromise = detectStaleSourcesOnStartup(plugin as any);
    await vi.runAllTimersAsync();
    await detectPromise;

    expect(queueMicrotaskSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ── processNewSourcesChunked: chunk size ≤ 100 ───────────────────────────────

describe('processNewSourcesChunked — chunk size must be ≤ 100', () => {
  /**
   * The current default chunk size is 1000, which is far too large and causes
   * multi-second blocking.  The fix should reduce it to ≤ 100.
   *
   * We verify by injecting 250 new markdown files and counting how many times
   * import_source is called before the first yield (setTimeout(0)).
   */
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('processes no more than 100 files before yielding to the event loop', async () => {
    const newFiles = Array.from({ length: 250 }, (_, i) => makeTFile(`new-${i}.md`));

    const plugin = makePlugin([], {});
    // Override getMarkdownFiles to return new (unknown) files
    plugin.app.vault.getMarkdownFiles = () => newFiles;
    // Remove chunkSize override — should use default; test verifies default ≤ 100
    plugin.settings.discovery_chunk_size = undefined;

    const importCallsAtFirstYield: number[] = [];
    let importCount = 0;

    plugin.source_collection.import_source = vi.fn(async () => { importCount++; });

    // Intercept setTimeout(0) to capture how many imports happened before first yield
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((fn: any, delay?: any, ...args: any[]) => {
      if (delay === 0 && importCallsAtFirstYield.length === 0) {
        importCallsAtFirstYield.push(importCount);
      }
      return realSetTimeout(fn, delay, ...args);
    });

    const processPromise = processNewSourcesChunked(plugin as any);
    await vi.runAllTimersAsync();
    await processPromise;

    // The first chunk must be ≤ 100 files
    expect(importCallsAtFirstYield[0]).toBeLessThanOrEqual(100);
  });
});
