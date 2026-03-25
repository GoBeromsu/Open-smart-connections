/**
 * @file reimport-during-chunked.test.ts
 * @description Tests that file changes during chunked processing are collected
 *              in pendingReImportPaths and processed after the kernel queue serializes them.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { runReImport, debounceReImport, queueSourceReImport } from '../src/ui/file-watcher';

function makePlugin(opts: {
  pendingPaths?: string[];
  pipelineActive?: boolean;
} = {}): any {
  const {
    pendingPaths = [],
    pipelineActive = false,
  } = opts;

  const pending = new Set<string>(pendingPaths);

  return {
    _unloading: false,
    re_import_timeout: undefined,
    pendingReImportPaths: pending,
    settings: { re_import_wait_time: 13 },
    embedding_pipeline: {
      is_active: vi.fn(() => pipelineActive),
    },
    source_collection: {
      import_source: vi.fn(async () => {}),
    },
    block_collection: { all: [] },
    app: {
      vault: {
        getAbstractFileByPath: vi.fn((path: string) => new TFile(path)),
      },
    },
    status_msg: { setText: vi.fn() },
    notices: { show: vi.fn() },
    refreshStatus: vi.fn(),
    logEmbed: vi.fn(),
    logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
    queueUnembeddedEntities: vi.fn(() => 0),
    setEmbedPhase: vi.fn(),
    enqueueEmbeddingJob: vi.fn(async () => undefined),
  };
}

describe('queueSourceReImport', () => {
  it('adds path to pendingReImportPaths set', () => {
    const plugin = makePlugin();
    queueSourceReImport(plugin, 'changed.md');
    expect(plugin.pendingReImportPaths.has('changed.md')).toBe(true);
    if (plugin.re_import_timeout) clearTimeout(plugin.re_import_timeout);
  });

  it('deduplicates paths in the set', () => {
    const plugin = makePlugin();
    queueSourceReImport(plugin, 'changed.md');
    queueSourceReImport(plugin, 'changed.md');
    expect(plugin.pendingReImportPaths.size).toBe(1);
    if (plugin.re_import_timeout) clearTimeout(plugin.re_import_timeout);
  });
});

describe('runReImport', () => {
  it('drains pendingReImportPaths and imports each file', async () => {
    const plugin = makePlugin({ pendingPaths: ['a.md', 'b.md'] });

    await runReImport(plugin);

    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(2);
    expect(plugin.pendingReImportPaths.size).toBe(0);
  });

  it('skips when no pending paths', async () => {
    const plugin = makePlugin({ pendingPaths: [] });

    await runReImport(plugin);

    expect(plugin.source_collection.import_source).not.toHaveBeenCalled();
  });

  it('re-enqueues when new paths are added during processing', async () => {
    const plugin = makePlugin({ pendingPaths: ['a.md'] });

    // Simulate a file change during import
    plugin.source_collection.import_source = vi.fn(async () => {
      plugin.pendingReImportPaths.add('new-change.md');
    });

    await runReImport(plugin);

    // Original path processed
    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(1);
    // New path still pending (enqueueReImportJob was called for re-queue)
    expect(plugin.pendingReImportPaths.has('new-change.md')).toBe(true);
    // enqueueEmbeddingJob was called for re-queue
    const reenqueueCalls = plugin.enqueueEmbeddingJob.mock.calls.filter(
      (c: any[]) => c[0]?.key === 'REIMPORT_SOURCES',
    );
    expect(reenqueueCalls.length).toBeGreaterThan(0);
  });
});

describe('debounceReImport', () => {
  it('schedules timer regardless of any state flags', () => {
    const plugin = makePlugin();
    debounceReImport(plugin);
    expect(plugin.re_import_timeout).toBeDefined();
    if (plugin.re_import_timeout) clearTimeout(plugin.re_import_timeout);
  });

  it('clears previous timer when called again', () => {
    const plugin = makePlugin();
    debounceReImport(plugin);
    const first = plugin.re_import_timeout;
    debounceReImport(plugin);
    expect(plugin.re_import_timeout).not.toBe(first);
    if (plugin.re_import_timeout) clearTimeout(plugin.re_import_timeout);
  });
});
