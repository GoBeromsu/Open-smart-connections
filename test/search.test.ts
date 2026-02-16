/**
 * @file search.test.ts
 * @description Tests for vector search functions
 */

import { describe, it, expect } from 'vitest';
import { findNearest, findFurthest, findNearestToEntity } from '../src/shared/search/vector-search';
import type { EmbeddingEntity } from '../src/shared/entities/EmbeddingEntity';
import type { SearchFilter } from '../src/shared/types/entities';

// Create mock entities for testing
function createMockEntity(key: string, vec: number[]): EmbeddingEntity {
  const entity: any = {
    key,
    data: {
      path: key,
      embeddings: {
        'test-model': { vec },
      },
    },
    vec,
    get_embed_input: async () => {},
    _queue_embed: false,
    is_unembedded: false,
    queue_embed: () => {
      entity._queue_embed = true;
    },
    set_active_embedding_meta: () => {},
    nearest: async () => [],
    has_embed: () => true,
    should_embed: false,
  };
  return entity as EmbeddingEntity;
}

describe('findNearest', () => {
  it('should find nearest entities to a vector', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('a', [1, 0, 0]),    // similarity: 1.0
      createMockEntity('b', [0.9, 0.1, 0]), // similarity: ~0.995
      createMockEntity('c', [0, 1, 0]),    // similarity: 0
      createMockEntity('d', [0.5, 0.5, 0]), // similarity: ~0.707
    ];

    const results = findNearest(queryVec, entities, { limit: 3 });

    expect(results).toHaveLength(3);
    expect(results[0].item.key).toBe('a');
    expect(results[0].score).toBeCloseTo(1, 2);
    expect(results[1].item.key).toBe('b');
    expect(results[2].item.key).toBe('d');
  });

  it('should respect limit parameter', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('a', [1, 0, 0]),
      createMockEntity('b', [0.9, 0.1, 0]),
      createMockEntity('c', [0.8, 0.2, 0]),
      createMockEntity('d', [0.7, 0.3, 0]),
    ];

    const results = findNearest(queryVec, entities, { limit: 2 });

    expect(results).toHaveLength(2);
  });

  it('should filter by exclude list', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('a', [1, 0, 0]),
      createMockEntity('b', [0.9, 0.1, 0]),
      createMockEntity('c', [0.8, 0.2, 0]),
    ];

    const results = findNearest(queryVec, entities, {
      limit: 3,
      exclude: ['a'],
    });

    expect(results).toHaveLength(2);
    expect(results.find(r => r.item.key === 'a')).toBeUndefined();
  });

  it('should filter by include list', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('a', [1, 0, 0]),
      createMockEntity('b', [0.9, 0.1, 0]),
      createMockEntity('c', [0.8, 0.2, 0]),
    ];

    const results = findNearest(queryVec, entities, {
      limit: 3,
      include: ['a', 'c'],
    });

    expect(results).toHaveLength(2);
    expect(results.find(r => r.item.key === 'b')).toBeUndefined();
  });

  it('should filter by key_starts_with', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('notes/a', [1, 0, 0]),
      createMockEntity('notes/b', [0.9, 0.1, 0]),
      createMockEntity('archive/c', [0.95, 0.05, 0]),
    ];

    const results = findNearest(queryVec, entities, {
      limit: 3,
      key_starts_with: 'notes/',
    });

    expect(results).toHaveLength(2);
    expect(results.every(r => r.item.key.startsWith('notes/'))).toBe(true);
  });

  it('should filter by key_does_not_start_with', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('notes/a', [1, 0, 0]),
      createMockEntity('notes/b', [0.9, 0.1, 0]),
      createMockEntity('archive/c', [0.95, 0.05, 0]),
    ];

    const results = findNearest(queryVec, entities, {
      limit: 3,
      key_does_not_start_with: 'archive/',
    });

    expect(results).toHaveLength(2);
    expect(results.every(r => !r.item.key.startsWith('archive/'))).toBe(true);
  });

  it('should filter by min_score', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('a', [1, 0, 0]),      // score: 1.0
      createMockEntity('b', [0.9, 0.1, 0]),  // score: ~0.995
      createMockEntity('c', [0, 1, 0]),      // score: 0
    ];

    const results = findNearest(queryVec, entities, {
      limit: 10,
      min_score: 0.9,
    });

    expect(results.length).toBeLessThanOrEqual(2);
    expect(results.every(r => r.score >= 0.9)).toBe(true);
  });

  it('should use custom filter function', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('a.md', [1, 0, 0]),
      createMockEntity('b.md', [0.9, 0.1, 0]),
      createMockEntity('c.txt', [0.95, 0.05, 0]),
    ];

    const results = findNearest(queryVec, entities, {
      limit: 3,
      filter_fn: (entity) => entity.key.endsWith('.md'),
    });

    expect(results).toHaveLength(2);
    expect(results.every(r => r.item.key.endsWith('.md'))).toBe(true);
  });

  it('should skip entities without vectors', () => {
    const queryVec = [1, 0, 0];
    const entityWithoutVec = createMockEntity('no-vec', []);
    entityWithoutVec.vec = null;

    const entities = [
      createMockEntity('a', [1, 0, 0]),
      entityWithoutVec,
      createMockEntity('b', [0.9, 0.1, 0]),
    ];

    const results = findNearest(queryVec, entities, { limit: 3 });

    expect(results).toHaveLength(2);
    expect(results.find(r => r.item.key === 'no-vec')).toBeUndefined();
  });

  it('should skip mismatched vector dimensions without mutating entities', () => {
    const queryVec = [1, 0, 0];
    const valid = createMockEntity('valid', [1, 0, 0]);
    const mismatch = createMockEntity('mismatch', [1, 0]);
    mismatch._queue_embed = false;

    const results = findNearest(queryVec, [valid, mismatch], { limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].item.key).toBe('valid');
    expect(mismatch.vec).toEqual([1, 0]);
    expect(mismatch._queue_embed).toBe(false);
  });

  it('should skip stale entities flagged as unembedded without mutating queue flags', () => {
    const queryVec = [1, 0, 0];
    const valid = createMockEntity('valid', [1, 0, 0]);
    const stale = createMockEntity('stale', [0.9, 0.1, 0]);
    stale.is_unembedded = true as any;

    const results = findNearest(queryVec, [valid, stale], { limit: 5 });

    expect(results).toHaveLength(1);
    expect(results[0].item.key).toBe('valid');
    expect(stale._queue_embed).toBe(false);
  });

  it('should return results sorted by score descending', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('low', [0.5, 0.5, 0]),
      createMockEntity('high', [1, 0, 0]),
      createMockEntity('medium', [0.8, 0.2, 0]),
    ];

    const results = findNearest(queryVec, entities, { limit: 3 });

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeGreaterThanOrEqual(results[i + 1].score);
    }
  });
});

describe('findFurthest', () => {
  it('should find furthest entities from a vector', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('a', [1, 0, 0]),      // similarity: 1.0 (closest)
      createMockEntity('b', [0.9, 0.1, 0]),  // similarity: ~0.995
      createMockEntity('c', [0, 1, 0]),      // similarity: 0 (furthest)
      createMockEntity('d', [0.5, 0.5, 0]),  // similarity: ~0.707
    ];

    const results = findFurthest(queryVec, entities, { limit: 2 });

    expect(results).toHaveLength(2);
    expect(results[0].item.key).toBe('c'); // Lowest score first
    expect(results[0].score).toBeCloseTo(0, 2);
  });

  it('should return results sorted by score ascending', () => {
    const queryVec = [1, 0, 0];
    const entities = [
      createMockEntity('high', [1, 0, 0]),
      createMockEntity('low', [0, 1, 0]),
      createMockEntity('medium', [0.5, 0.5, 0]),
    ];

    const results = findFurthest(queryVec, entities, { limit: 3 });

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i + 1].score);
    }
  });
});

describe('findNearestToEntity', () => {
  it('should find nearest entities to a given entity', () => {
    const refEntity = createMockEntity('ref', [1, 0, 0]);
    const entities = [
      refEntity,
      createMockEntity('a', [0.9, 0.1, 0]),
      createMockEntity('b', [0.8, 0.2, 0]),
      createMockEntity('c', [0, 1, 0]),
    ];

    const results = findNearestToEntity(refEntity, entities, { limit: 3 });

    // Should exclude the reference entity itself
    expect(results).toHaveLength(3);
    expect(results.find(r => r.item.key === 'ref')).toBeUndefined();
  });

  it('should throw error if reference entity has no vector', () => {
    const refEntity = createMockEntity('ref', []);
    refEntity.vec = null;

    const entities = [
      createMockEntity('a', [1, 0, 0]),
    ];

    expect(() => findNearestToEntity(refEntity, entities, { limit: 1 }))
      .toThrow('Reference entity has no embedding vector');
  });

  it('should combine exclude list with reference entity', () => {
    const refEntity = createMockEntity('ref', [1, 0, 0]);
    const entities = [
      refEntity,
      createMockEntity('a', [0.9, 0.1, 0]),
      createMockEntity('b', [0.8, 0.2, 0]),
      createMockEntity('c', [0.7, 0.3, 0]),
    ];

    const results = findNearestToEntity(refEntity, entities, {
      limit: 3,
      exclude: ['b'],
    });

    expect(results).toHaveLength(2);
    expect(results.find(r => r.item.key === 'ref')).toBeUndefined();
    expect(results.find(r => r.item.key === 'b')).toBeUndefined();
  });
});
