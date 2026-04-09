import { describe, expect, it, vi } from 'vitest';

import {
  buildFolderExclusionConfirmMessage,
  queueExcludedFolderReconcile,
  queueRemovedFolderReembed,
} from '../src/ui/folder-exclusion-actions';
import { TFile, TFolder } from 'obsidian';

function createPlugin(overrides: Record<string, unknown> = {}) {
  const plugin = {
    app: {
      workspace: {
        trigger: vi.fn(),
      },
      vault: {
        getAllLoadedFiles: vi.fn(() => []),
      },
    },
    settings: {
      smart_sources: {
        folder_exclusions: 'Archive',
      },
    },
    source_collection: {
      all: [
        { key: 'Archive/a.md' },
        { key: 'Keep/b.md' },
      ],
      data_adapter: { save: vi.fn(async () => {}) },
      recomputeEmbeddedCount: vi.fn(),
    },
    block_collection: {
      data_adapter: { save: vi.fn(async () => {}) },
      recomputeEmbeddedCount: vi.fn(),
    },
    removeSource: vi.fn(),
    processNewSourcesChunked: vi.fn(async () => {}),
    refreshStatus: vi.fn(),
    logger: { info: vi.fn() },
    notices: { show: vi.fn() },
    queueSourceReImport: vi.fn(),
    getEmbedRuntimeState: vi.fn(() => ({
      backfill: { kind: 'idle' },
    })),
    enqueueEmbeddingJob: vi.fn(async (job: { run: () => Promise<void> }) => {
      await job.run();
    }),
    ...overrides,
  } as any;

  return plugin;
}

describe('buildFolderExclusionConfirmMessage', () => {
  it('mentions removal and next-run deferral when a run is active', () => {
    const message = buildFolderExclusionConfirmMessage('Archive', true);
    expect(message).toContain('Existing embeddings for this folder will be removed.');
    expect(message).toContain('apply on the next run');
  });
});

describe('queueExcludedFolderReconcile', () => {
  it('removes currently indexed sources inside excluded folders and re-runs discovery', async () => {
    const plugin = createPlugin();

    await queueExcludedFolderReconcile(plugin, 'test reconcile');

    expect(plugin.removeSource).toHaveBeenCalledWith('Archive/a.md');
    expect(plugin.removeSource).not.toHaveBeenCalledWith('Keep/b.md');
    expect(plugin.processNewSourcesChunked).toHaveBeenCalledTimes(1);
    expect(plugin.notices.show).toHaveBeenCalledWith('folder_exclusion_reconcile_applied');
  });

  it('shows a deferred notice when the current embedding run is active', async () => {
    const plugin = createPlugin({
      getEmbedRuntimeState: vi.fn(() => ({
        backfill: { kind: 'running' },
      })),
    });

    await queueExcludedFolderReconcile(plugin, 'active run');

    expect(plugin.notices.show).toHaveBeenCalledWith('folder_exclusion_reconcile_deferred');
  });
});

describe('queueRemovedFolderReembed', () => {
  it('queues existing markdown files in the removed folder through the existing reimport path', async () => {
    const file = new TFile('_oc_cleanup_roundtrip/note.md');
    const plugin = createPlugin({
      app: {
        workspace: { trigger: vi.fn() },
        vault: {
          getAllLoadedFiles: vi.fn(() => [
            new TFolder(''),
            new TFolder('_oc_cleanup_roundtrip'),
            file,
          ]),
        },
      },
    });

    await queueRemovedFolderReembed(plugin, '_oc_cleanup_roundtrip');

    expect(plugin.queueSourceReImport).toHaveBeenCalledWith('_oc_cleanup_roundtrip/note.md');
    expect(plugin.processNewSourcesChunked).not.toHaveBeenCalled();
  });

  it('falls back to discovery when no matching vault files are found', async () => {
    const plugin = createPlugin();

    await queueRemovedFolderReembed(plugin, '_oc_cleanup_roundtrip');

    expect(plugin.queueSourceReImport).not.toHaveBeenCalled();
    expect(plugin.processNewSourcesChunked).toHaveBeenCalledTimes(1);
  });
});
