/**
 * @file reimport-during-chunked.test.ts
 * @description Tests that re-import is suppressed during chunked pipeline processing.
 *
 * Bug: editor-change/active-leaf-change events fire during processNewSourcesChunked,
 *      triggering debounceReImport -> runReImport -> deferReImport 20x -> gives up.
 *
 * Fix: Suppress runReImport while _chunked_pipeline_active is true.
 */

import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { runReImport, debounceReImport } from '../src/ui/file-watcher';
import { EmbedJobQueue } from '../src/domain/embedding/embed-job-queue';

function makePlugin(opts: {
  pipelineActive?: boolean;
  chunkedPipelineActive?: boolean;
  queuePaths?: string[];
} = {}): any {
  const {
    pipelineActive = false,
    chunkedPipelineActive = false,
    queuePaths = [],
  } = opts;

  const queue = new EmbedJobQueue();
  for (const path of queuePaths) {
    queue.enqueue({
      entityKey: path,
      contentHash: '',
      sourcePath: path.split('#')[0],
      enqueuedAt: Date.now(),
    });
  }

  return {
    _unloading: false,
    _chunked_pipeline_active: chunkedPipelineActive,
    _defer_retry_count: 0,
    re_import_halted: false,
    re_import_timeout: undefined,
    re_import_retry_timeout: undefined,
    settings: { re_import_wait_time: 13 },
    embed_job_queue: queue,
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
    dispatchKernelEvent: vi.fn(),
    logEmbed: vi.fn(),
    queueUnembeddedEntities: vi.fn(() => 0),
    runEmbeddingJobImmediate: vi.fn(async () => null),
    enqueueEmbeddingJob: vi.fn(async (job: any) => job.run()),
  };
}

describe('runReImport during chunked pipeline', () => {
  it('skips immediately when _chunked_pipeline_active is true', async () => {
    const plugin = makePlugin({
      chunkedPipelineActive: true,
      pipelineActive: true,
      queuePaths: ['changed.md'],
    });

    await runReImport(plugin);

    // Queue is preserved (not dropped) — runReImport returns early without clearing the queue
    expect(plugin.embed_job_queue.size()).toBe(1);
    // source_collection.import_source should NOT have been called
    expect(plugin.source_collection.import_source).not.toHaveBeenCalled();
  });

  it('does NOT enter defer loop when chunked pipeline is active', async () => {
    const plugin = makePlugin({
      chunkedPipelineActive: true,
      pipelineActive: true,
      queuePaths: ['a.md', 'b.md'],
    });

    await runReImport(plugin);

    const statusCalls = plugin.status_msg.setText.mock.calls;
    const deferMessages = statusCalls.filter((c: any[]) =>
      String(c[0]).includes('Deferring') || String(c[0]).includes('updates queued'),
    );
    expect(deferMessages).toHaveLength(0);
  });

  it('processes re-import normally when chunked pipeline is NOT active', async () => {
    const plugin = makePlugin({
      chunkedPipelineActive: false,
      pipelineActive: false,
      queuePaths: ['changed.md'],
    });

    await runReImport(plugin);

    expect(plugin.source_collection.import_source).toHaveBeenCalled();
    expect(plugin.runEmbeddingJobImmediate).toHaveBeenCalled();
  });
});

describe('debounceReImport during chunked pipeline', () => {
  it('does NOT schedule timer when _chunked_pipeline_active is true', () => {
    const plugin = makePlugin({ chunkedPipelineActive: true });
    debounceReImport(plugin);
    expect(plugin.re_import_timeout).toBeUndefined();
  });

  it('schedules timer when _chunked_pipeline_active is false', () => {
    const plugin = makePlugin({ chunkedPipelineActive: false });
    debounceReImport(plugin);
    expect(plugin.re_import_timeout).toBeDefined();
    if (plugin.re_import_timeout) clearTimeout(plugin.re_import_timeout);
  });
});
