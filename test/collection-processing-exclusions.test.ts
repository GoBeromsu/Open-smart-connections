import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';

import { processNewSourcesChunked } from '../src/ui/collection-processing';

function makeTFile(path: string): TFile {
  const file = Object.create(TFile.prototype) as TFile & {
    path: string;
    extension: string;
    stat: { mtime: number; size: number };
  };
  file.path = path;
  file.extension = 'md';
  file.stat = { mtime: Date.now(), size: 500 } as never;
  return file;
}

function makePlugin(files: TFile[]) {
  const importSource = vi.fn(async () => {});
  const save = vi.fn(async () => {});
  return {
    _unloading: false,
    pendingReImportPaths: new Set<string>(),
    settings: {
      smart_sources: {
        folder_exclusions: 'Projects/Archive',
        file_exclusions: '',
      },
    },
    source_collection: {
      all: [],
      vault: {},
      _initializing: false,
      import_source: importSource,
      recomputeEmbeddedCount: vi.fn(),
      data_adapter: { save },
    },
    block_collection: {
      all: [],
      recomputeEmbeddedCount: vi.fn(),
      data_adapter: { save },
    },
    app: {
      vault: {
        getMarkdownFiles: () => files,
      },
      workspace: {
        trigger: vi.fn(),
      },
    },
    logger: {
      debug: vi.fn(),
      warn: vi.fn(),
    },
    runEmbeddingJob: vi.fn(async () => {}),
  };
}

describe('processNewSourcesChunked folder exclusions', () => {
  it('skips files under excluded nested folder paths during discovery', async () => {
    const files = [
      makeTFile('Projects/Archive/a.md'),
      makeTFile('Projects/Archive/sub/b.md'),
      makeTFile('Projects/Keep/c.md'),
    ];
    const plugin = makePlugin(files);

    await processNewSourcesChunked(plugin as never);

    expect(plugin.source_collection.import_source).toHaveBeenCalledTimes(1);
    expect(plugin.source_collection.import_source).toHaveBeenCalledWith(files[2]);
  });
});
