/**
 * @file chunked-processing.test.ts
 * @description Regression tests for chunked async processing.
 */

import { describe, expect, it, vi } from 'vitest';
import { processInChunks } from '../../src/utils';

describe('processInChunks', () => {
  it('processes all items and aggregates results in order', async () => {
    const results = await processInChunks(
      [1, 2, 3, 4, 5],
      2,
      async (chunk) => chunk.map((value) => value * 2),
      vi.fn(async () => {}),
    );

    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('yields between chunks but not after the last one', async () => {
    const yieldFn = vi.fn(async () => {});

    await processInChunks(
      [1, 2, 3, 4, 5, 6],
      2,
      async (chunk) => chunk,
      yieldFn,
    );

    expect(yieldFn).toHaveBeenCalledTimes(2);
  });
});
