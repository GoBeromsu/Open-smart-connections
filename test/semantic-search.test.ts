import { describe, expect, it, vi } from 'vitest';

import { getSourceConnections, searchNearestAcrossCollections } from '../src/domain/semantic-search';

describe('searchNearestAcrossCollections', () => {
  it('merges collection results, sorts by score, and dedupes by key', async () => {
    const collections = [
      {
        nearest: vi.fn().mockResolvedValue([
          { item: { key: 'a.md' }, score: 0.8 },
          { item: { key: 'b.md' }, score: 0.7 },
        ]),
      },
      {
        nearest: vi.fn().mockResolvedValue([
          { item: { key: 'a.md' }, score: 0.95 },
          { item: { key: 'c.md' }, score: 0.75 },
        ]),
      },
    ];

    const results = await searchNearestAcrossCollections(collections, [1, 0], 3);

    expect(results).toEqual([
      { item: { key: 'a.md' }, score: 0.95 },
      { item: { key: 'c.md' }, score: 0.75 },
      { item: { key: 'b.md' }, score: 0.7 },
    ]);
  });
});

describe('getSourceConnections', () => {
  function makeBlock(opts: {
    key: string;
    sourceKey: string;
    score?: number;
    vec?: number[] | null;
    hasEmbed?: boolean;
    headings?: string[];
    text?: string;
  }) {
    return {
      key: opts.key,
      source_key: opts.sourceKey,
      data: { headings: opts.headings ?? [], text: opts.text ?? '' },
      vec: opts.vec ?? [1, 0],
      has_embed: () => opts.hasEmbed ?? true,
      evictVec: vi.fn(),
    };
  }

  it('returns note-level matches deduped by source path', async () => {
    const fileBlock = makeBlock({ key: 'note.md#one', sourceKey: 'note.md' });
    const blockCollection = {
      for_source: vi.fn().mockReturnValue([fileBlock]),
      ensure_entity_vector: vi.fn(async () => {}),
      nearest: vi.fn().mockResolvedValue([
        { item: makeBlock({ key: 'other.md#alpha', sourceKey: 'other.md', headings: ['Alpha'] }), score: 0.81 },
        { item: makeBlock({ key: 'other.md#beta', sourceKey: 'other.md', headings: ['Beta'] }), score: 0.93 },
        { item: makeBlock({ key: 'third.md#one', sourceKey: 'third.md' }), score: 0.79 },
      ]),
    };

    const results = await getSourceConnections(blockCollection as any, 'note.md', 10);

    expect(results).toHaveLength(2);
    expect(results[0]?.item.key).toBe('other.md#beta');
    expect(results[1]?.item.key).toBe('third.md#one');
  });

  it('returns empty results when the source note has no embedded blocks', async () => {
    const blockCollection = {
      for_source: vi.fn().mockReturnValue([
        makeBlock({ key: 'note.md#one', sourceKey: 'note.md', hasEmbed: false }),
      ]),
      ensure_entity_vector: vi.fn(async () => {}),
      nearest: vi.fn(),
    };

    const results = await getSourceConnections(blockCollection as any, 'note.md', 10);

    expect(results).toEqual([]);
    expect(blockCollection.nearest).not.toHaveBeenCalled();
  });
});
