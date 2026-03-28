import { describe, it, expect, beforeEach } from 'vitest';
import { FlatVectorIndex } from '../src/domain/flat-vector-index';

function makeRows(vecs: number[][]): { entity_key: string; vec: Float32Array }[] {
  return vecs.map((v, i) => ({ entity_key: `item-${i}`, vec: new Float32Array(v) }));
}

describe('FlatVectorIndex', () => {
  let index: FlatVectorIndex;

  beforeEach(() => {
    index = new FlatVectorIndex();
  });

  it('loads rows and reports correct size', () => {
    index.load(makeRows([[1, 0, 0], [0, 1, 0], [0, 0, 1]]), 3);
    expect(index.size).toBe(3);
    expect(index.dims).toBe(3);
  });

  it('returns empty for empty index', async () => {
    const results = await index.queryNearest(new Float32Array([1, 0, 0]), {}, 5);
    expect(results).toEqual([]);
  });

  it('finds nearest by cosine similarity', async () => {
    index.load(makeRows([[1, 0, 0], [0, 1, 0], [0.9, 0.1, 0]]), 3);
    const results = await index.queryNearest(new Float32Array([1, 0, 0]), {}, 3);
    expect(results.length).toBe(3);
    expect(results[0]!.entity_key).toBe('item-0');
    expect(results[0]!.score).toBeCloseTo(1.0, 5);
    expect(results[1]!.entity_key).toBe('item-2');
  });

  it('respects limit', async () => {
    index.load(makeRows([[1, 0], [0, 1], [0.5, 0.5]]), 2);
    const results = await index.queryNearest(new Float32Array([1, 0]), {}, 1);
    expect(results.length).toBe(1);
  });

  it('respects exclude filter', async () => {
    index.load(makeRows([[1, 0, 0], [0.9, 0.1, 0]]), 3);
    const results = await index.queryNearest(
      new Float32Array([1, 0, 0]),
      { exclude: ['item-0'] },
      5,
    );
    expect(results.length).toBe(1);
    expect(results[0]!.entity_key).toBe('item-1');
  });

  it('respects min_score filter', async () => {
    index.load(makeRows([[1, 0, 0], [0, 1, 0]]), 3);
    const results = await index.queryNearest(
      new Float32Array([1, 0, 0]),
      { min_score: 0.5 },
      5,
    );
    expect(results.length).toBe(1);
    expect(results[0]!.entity_key).toBe('item-0');
  });

  it('respects key_starts_with filter', async () => {
    const rows = [
      { entity_key: 'notes/a.md#h1', vec: new Float32Array([1, 0]) },
      { entity_key: 'notes/b.md#h1', vec: new Float32Array([0.9, 0.1]) },
      { entity_key: 'other/c.md#h1', vec: new Float32Array([0.8, 0.2]) },
    ];
    index.load(rows, 2);
    const results = await index.queryNearest(
      new Float32Array([1, 0]),
      { key_starts_with: 'notes/' },
      5,
    );
    expect(results.length).toBe(2);
    expect(results.every(r => r.entity_key.startsWith('notes/'))).toBe(true);
  });

  describe('upsert', () => {
    it('adds a new vector', () => {
      index.load(makeRows([[1, 0]]), 2);
      expect(index.size).toBe(1);
      index.upsert('new-item', new Float32Array([0, 1]));
      expect(index.size).toBe(2);
    });

    it('updates existing vector', async () => {
      index.load(makeRows([[1, 0], [0, 1]]), 2);
      index.upsert('item-1', new Float32Array([0.9, 0.1]));
      const results = await index.queryNearest(new Float32Array([1, 0]), {}, 2);
      expect(results[1]!.entity_key).toBe('item-1');
      expect(results[1]!.score).toBeGreaterThan(0.5);
    });
  });

  describe('remove', () => {
    it('removes a vector by key', () => {
      index.load(makeRows([[1, 0], [0, 1], [0.5, 0.5]]), 2);
      expect(index.size).toBe(3);
      index.remove('item-1');
      expect(index.size).toBe(2);
    });

    it('removed vector is not in query results', async () => {
      index.load(makeRows([[1, 0, 0], [0.9, 0.1, 0]]), 3);
      index.remove('item-0');
      const results = await index.queryNearest(new Float32Array([1, 0, 0]), {}, 5);
      expect(results.length).toBe(1);
      expect(results[0]!.entity_key).toBe('item-1');
    });
  });

  it('clear empties the index', () => {
    index.load(makeRows([[1, 0], [0, 1]]), 2);
    index.clear();
    expect(index.size).toBe(0);
  });
});
