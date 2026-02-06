/**
 * @file utils.test.ts
 * @description Tests for utility functions
 */

import { describe, it, expect } from 'vitest';
import { cos_sim } from '../core/utils/cos_sim';
import { results_acc, furthest_acc } from '../core/utils/results_acc';
import { create_hash } from '../core/utils/create_hash';
import { deep_merge } from '../core/utils/deep_merge';
import type { ScoredResult, ResultsAccumulator, FurthestAccumulator } from '../core/utils/results_acc';

describe('cos_sim', () => {
  it('should calculate cosine similarity between two vectors', () => {
    const vec1 = [1, 0, 0];
    const vec2 = [1, 0, 0];
    const similarity = cos_sim(vec1, vec2);
    expect(similarity).toBe(1);
  });

  it('should return 0 for orthogonal vectors', () => {
    const vec1 = [1, 0, 0];
    const vec2 = [0, 1, 0];
    const similarity = cos_sim(vec1, vec2);
    expect(similarity).toBe(0);
  });

  it('should return negative value for opposite vectors', () => {
    const vec1 = [1, 0, 0];
    const vec2 = [-1, 0, 0];
    const similarity = cos_sim(vec1, vec2);
    expect(similarity).toBe(-1);
  });

  it('should handle normalized vectors correctly', () => {
    const vec1 = [0.6, 0.8];
    const vec2 = [0.8, 0.6];
    const similarity = cos_sim(vec1, vec2);
    expect(similarity).toBeCloseTo(0.96, 2);
  });

  it('should throw error for vectors of different lengths', () => {
    const vec1 = [1, 0];
    const vec2 = [1, 0, 0];
    expect(() => cos_sim(vec1, vec2)).toThrow('Vectors must have the same length');
  });

  it('should return 0 for zero magnitude vectors', () => {
    const vec1 = [0, 0, 0];
    const vec2 = [1, 2, 3];
    const similarity = cos_sim(vec1, vec2);
    expect(similarity).toBe(0);
  });
});

describe('results_acc', () => {
  it('should accumulate top-k results', () => {
    const acc: ResultsAccumulator = {
      results: new Set(),
      min: Number.POSITIVE_INFINITY,
      minResult: null,
    };

    // Add 5 results with limit of 3
    results_acc(acc, { item: 'a', score: 0.5 }, 3);
    results_acc(acc, { item: 'b', score: 0.8 }, 3);
    results_acc(acc, { item: 'c', score: 0.3 }, 3);
    results_acc(acc, { item: 'd', score: 0.9 }, 3);
    results_acc(acc, { item: 'e', score: 0.1 }, 3);

    // Should keep top 3: b(0.8), d(0.9), a(0.5)
    expect(acc.results.size).toBe(3);
    const scores = Array.from(acc.results).map(r => r.score);
    expect(scores).toContain(0.8);
    expect(scores).toContain(0.9);
    expect(scores).toContain(0.5);
    expect(scores).not.toContain(0.3);
    expect(scores).not.toContain(0.1);
  });

  it('should handle accumulator with fewer items than limit', () => {
    const acc: ResultsAccumulator = {
      results: new Set(),
      min: Number.POSITIVE_INFINITY,
      minResult: null,
    };

    results_acc(acc, { item: 'a', score: 0.5 }, 10);
    results_acc(acc, { item: 'b', score: 0.8 }, 10);

    expect(acc.results.size).toBe(2);
  });

  it('should maintain min threshold correctly', () => {
    const acc: ResultsAccumulator = {
      results: new Set(),
      min: Number.POSITIVE_INFINITY,
      minResult: null,
    };

    results_acc(acc, { item: 'a', score: 0.5 }, 2);
    results_acc(acc, { item: 'b', score: 0.8 }, 2);

    // Min should be 0.5 (lowest of the two)
    expect(acc.min).toBe(0.5);

    // Adding higher score should maintain top 2
    results_acc(acc, { item: 'c', score: 0.9 }, 2);
    expect(acc.min).toBe(0.8);
  });
});

describe('furthest_acc', () => {
  it('should accumulate bottom-k results', () => {
    const acc: FurthestAccumulator = {
      results: new Set(),
      max: Number.NEGATIVE_INFINITY,
      maxResult: null,
    };

    // Add 5 results with limit of 3
    furthest_acc(acc, { item: 'a', score: 0.5 }, 3);
    furthest_acc(acc, { item: 'b', score: 0.8 }, 3);
    furthest_acc(acc, { item: 'c', score: 0.3 }, 3);
    furthest_acc(acc, { item: 'd', score: 0.9 }, 3);
    furthest_acc(acc, { item: 'e', score: 0.1 }, 3);

    // Should keep bottom 3: e(0.1), c(0.3), a(0.5)
    expect(acc.results.size).toBe(3);
    const scores = Array.from(acc.results).map(r => r.score);
    expect(scores).toContain(0.1);
    expect(scores).toContain(0.3);
    expect(scores).toContain(0.5);
    expect(scores).not.toContain(0.8);
    expect(scores).not.toContain(0.9);
  });
});

describe('create_hash', () => {
  it('should generate consistent hash for same input', async () => {
    const input = 'test content';
    const hash1 = await create_hash(input);
    const hash2 = await create_hash(input);
    expect(hash1).toBe(hash2);
  });

  it('should generate different hashes for different inputs', async () => {
    const hash1 = await create_hash('content1');
    const hash2 = await create_hash('content2');
    expect(hash1).not.toBe(hash2);
  });

  it('should handle empty string', async () => {
    const hash = await create_hash('');
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe('string');
  });

  it('should handle unicode characters', async () => {
    const hash1 = await create_hash('Hello 世界');
    const hash2 = await create_hash('Hello 世界');
    expect(hash1).toBe(hash2);
  });
});

describe('deep_merge', () => {
  it('should merge two simple objects', () => {
    const obj1 = { a: 1, b: 2 };
    const obj2 = { b: 3, c: 4 };
    const result = deep_merge(obj1, obj2);
    expect(result).toEqual({ a: 1, b: 3, c: 4 });
  });

  it('should merge nested objects', () => {
    const obj1 = { a: { x: 1, y: 2 }, b: 1 };
    const obj2 = { a: { y: 3, z: 4 }, c: 2 };
    const result = deep_merge(obj1, obj2);
    expect(result).toEqual({
      a: { x: 1, y: 3, z: 4 },
      b: 1,
      c: 2,
    });
  });

  it('should handle arrays by replacing', () => {
    const obj1 = { arr: [1, 2, 3] };
    const obj2 = { arr: [4, 5] };
    const result = deep_merge(obj1, obj2);
    expect(result).toEqual({ arr: [4, 5] });
  });

  it('should handle null and undefined values', () => {
    const obj1 = { a: 1, b: null };
    const obj2 = { b: 2, c: undefined };
    const result = deep_merge(obj1, obj2);
    expect(result.a).toBe(1);
    expect(result.b).toBe(2);
  });

  it('should mutate target object and merge source', () => {
    const obj1 = { a: { x: 1 } };
    const obj2 = { a: { y: 2 } };
    const result = deep_merge(obj1, obj2);

    // deep_merge mutates obj1 (documented behavior)
    expect(obj1).toBe(result);
    expect(obj1).toEqual({ a: { x: 1, y: 2 } });
    expect(obj2).toEqual({ a: { y: 2 } }); // obj2 not mutated
  });
});
