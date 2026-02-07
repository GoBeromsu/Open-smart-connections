/**
 * @file find-connections.test.ts
 * @description Tests for merged source/block connection search
 */

import { describe, it, expect } from 'vitest';
import { find_connections, get_source_path } from '../core/search/find-connections';
import type { EmbeddingEntity } from '../core/entities/EmbeddingEntity';

function createMockEntity(key: string, vec: number[] | null): EmbeddingEntity {
  const entity: any = {
    key,
    data: {
      path: key.split('#')[0],
      embeddings: {
        'test-model': vec ? { vec } : {},
      },
    },
    vec,
    _queue_embed: false,
    queue_embed: () => {
      entity._queue_embed = true;
    },
  };
  return entity as EmbeddingEntity;
}

describe('find_connections', () => {
  it('returns empty when reference entity has no embedding', () => {
    const ref = createMockEntity('ref.md', null);
    const results = find_connections(ref, [], []);
    expect(results).toEqual([]);
  });

  it('merges source and block results by source path using best score', () => {
    const ref = createMockEntity('ref.md', [1, 0]);

    const sourceEntities = [
      createMockEntity('alpha.md', [0.9, 0.1]),
      createMockEntity('beta.md', [0.8, 0.2]),
    ];

    const blockEntities = [
      createMockEntity('alpha.md#section', [0.7, 0.3]), // same source as alpha.md but lower score
      createMockEntity('gamma.md#part', [1, 0]), // highest score overall
    ];

    const results = find_connections(ref, sourceEntities, blockEntities, { limit: 10 });

    const keys = results.map(r => r.item.key);
    expect(keys).toContain('alpha.md');
    expect(keys).not.toContain('alpha.md#section');
    expect(keys).toContain('beta.md');
    expect(keys).toContain('gamma.md#part');
    expect(results[0].item.key).toBe('gamma.md#part');
  });

  it('excludes blocks from the same source by default', () => {
    const ref = createMockEntity('daily/note.md#intro', [1, 0]);
    const blockEntities = [
      createMockEntity('daily/note.md#h1', [0.99, 0.01]), // should be filtered out
      createMockEntity('other.md#h1', [0.8, 0.2]),
    ];

    const results = find_connections(ref, [], blockEntities);
    const keys = results.map(r => r.item.key);

    expect(keys).not.toContain('daily/note.md#h1');
    expect(keys).toContain('other.md#h1');
  });

  it('can include same-source blocks when exclude_same_source is false', () => {
    const ref = createMockEntity('daily/note.md#intro', [1, 0]);
    const blockEntities = [createMockEntity('daily/note.md#h1', [0.99, 0.01])];

    const results = find_connections(ref, [], blockEntities, {
      exclude_same_source: false,
    });

    expect(results).toHaveLength(1);
    expect(results[0].item.key).toBe('daily/note.md#h1');
  });
});

describe('get_source_path', () => {
  it('returns source path for source keys and block keys', () => {
    expect(get_source_path('a/b/note.md')).toBe('a/b/note.md');
    expect(get_source_path('a/b/note.md#h1#h2')).toBe('a/b/note.md');
  });
});
