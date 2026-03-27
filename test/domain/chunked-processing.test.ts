/**
 * @file chunked-processing.test.ts
 * @description Tests for a generic processInChunks() utility (to be added to utils/).
 *
 * Desired behaviour:
 *   - processes every item exactly once
 *   - respects the requested chunk size
 *   - calls yieldFn between chunks (not after the last chunk)
 *   - returns the aggregated results from processFn
 *
 */

import { describe, it, expect, vi } from 'vitest';
import { processInChunks } from '../../src/utils/index';

describe('processInChunks', () => {
  it('processes all items and returns aggregated results', async () => {
    const items = [1, 2, 3, 4, 5];
    const yieldFn = vi.fn(async () => {});

    const results = await processInChunks(
      items,
      2,
      async (chunk: number[]) => chunk.map(x => x * 2),
      yieldFn,
    );

    expect(results).toEqual([2, 4, 6, 8, 10]);
  });

  it('calls yieldFn (chunkCount - 1) times — between chunks, not after the last', async () => {
    const items = [1, 2, 3, 4, 5, 6]; // 6 items / chunkSize 2 = 3 chunks → 2 yields
    const yieldFn = vi.fn(async () => {});

    await processInChunks(items, 2, async (chunk: number[]) => chunk, yieldFn);

    expect(yieldFn).toHaveBeenCalledTimes(2);
  });

  it('does not call yieldFn when there is only one chunk', async () => {
    const items = [1, 2, 3];
    const yieldFn = vi.fn(async () => {});

    await processInChunks(items, 10, async (chunk: number[]) => chunk, yieldFn);

    expect(yieldFn).toHaveBeenCalledTimes(0);
  });

  it('respects chunk size — processFn never receives more items than chunkSize', async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    const chunkSizes: number[] = [];
    const yieldFn = vi.fn(async () => {});

    await processInChunks(
      items,
      3,
      async (chunk: number[]) => { chunkSizes.push(chunk.length); return chunk; },
      yieldFn,
    );

    // chunks: [3, 3, 3, 1]
    expect(chunkSizes.every(s => s <= 3)).toBe(true);
    expect(chunkSizes).toEqual([3, 3, 3, 1]);
  });

  it('handles an empty items array without calling yieldFn', async () => {
    const yieldFn = vi.fn(async () => {});

    const results = await processInChunks([], 5, async (chunk: number[]) => chunk, yieldFn);

    expect(results).toEqual([]);
    expect(yieldFn).toHaveBeenCalledTimes(0);
  });

  it('yieldFn is called after each non-final chunk, before the next processFn call', async () => {
    const callOrder: string[] = [];
    const items = [1, 2, 3, 4];
    const yieldFn = vi.fn(async () => { callOrder.push('yield'); });

    await processInChunks(
      items,
      2,
      async (chunk: number[]) => { callOrder.push(`process(${chunk})`); return chunk; },
      yieldFn,
    );

    // Expected: process([1,2]), yield, process([3,4])
    expect(callOrder).toEqual(['process(1,2)', 'yield', 'process(3,4)']);
  });
});
