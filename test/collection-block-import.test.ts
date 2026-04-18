import { describe, expect, it, vi } from 'vitest';

import { importBlocksChunked } from '../src/ui/collection-block-import';

function makeSource(key: string) {
  return { key };
}

describe('importBlocksChunked', () => {
  it('caps startup imports and reports remaining backlog', async () => {
    const sources = Array.from({ length: 120 }, (_, index) => makeSource(`note-${index}.md`));
    const importSourceBlocks = vi.fn(async () => {});
    const save = vi.fn(async () => {});

    const plugin = {
      _unloading: false,
      logger: {
        debug: vi.fn(),
        warn: vi.fn(),
      },
      source_collection: {
        all: sources,
      },
      block_collection: {
        for_source: vi.fn(() => []),
        import_source_blocks: importSourceBlocks,
        data_adapter: { save },
      },
    } as never;

    const result = await importBlocksChunked(plugin, { limit: 50 });

    expect(importSourceBlocks).toHaveBeenCalledTimes(50);
    expect(result).toEqual({
      importedCount: 50,
      remainingCount: 70,
      totalCount: 120,
    });
    expect(save).toHaveBeenCalledTimes(2);
  });
});
