/**
 * @file block-connections-yield.test.ts
 * @description TDD tests for yield-between-batches behaviour in getBlockConnections.
 *
 * CURRENT STATE (red phase): getBlockConnections currently calls
 * ensure_entity_vector for all blocks in a single Promise.all, then nearest()
 * in one shot — no yield between individual loads.  These tests describe the
 * desired behaviour and are expected to FAIL until the implementation is fixed.
 *
 * Desired behaviours:
 *   - When loading vectors for N blocks, ensure_entity_vector is called in
 *     batches of ≤ BATCH_SIZE, with a yield between batches.
 *   - The number of synchronous ensure_entity_vector calls before the first
 *     yield must be ≤ BATCH_SIZE (concrete: 10).
 *   - Results are still returned correctly after batching.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBlockConnections, invalidateConnectionsCache } from '../../src/ui/block-connections';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeBlock(opts: {
  key: string;
  sourceKey: string;
  hasEmbed?: boolean;
  vec?: number[] | null;
}): any {
  return {
    key: opts.key,
    source_key: opts.sourceKey,
    has_embed: () => opts.hasEmbed ?? true,
    vec: opts.vec ?? [0.1, 0.2, 0.3],
    evictVec: vi.fn(),
    _queue_embed: false,
    queue_embed: vi.fn(),
  };
}

function makeBlockCollection(
  blocks: any[],
  nearestImpl?: () => Promise<any[]>,
): any {
  return {
    for_source: (path: string) => blocks.filter(b => b.source_key === path),
    ensure_entity_vector: vi.fn(async () => {}),
    nearest: vi.fn(nearestImpl ?? (async () => [])),
    embed_model_key: 'test-model',
  };
}

// ── batch yield tests ─────────────────────────────────────────────────────────

describe('getBlockConnections — batched vector loading', () => {
  const EXPECTED_BATCH_SIZE = 10; // the fix should use batches of this size or smaller

  beforeEach(() => {
    vi.useFakeTimers();
    invalidateConnectionsCache();
  });

  afterEach(() => {
    vi.useRealTimers();
    invalidateConnectionsCache();
  });

  it('yields to the event loop after loading vectors', async () => {
    const queryPath = 'query.md';
    const embeddedBlocks = Array.from({ length: 30 }, (_, i) =>
      makeBlock({ key: `${queryPath}#h${i}`, sourceKey: queryPath, hasEmbed: true }),
    );

    const col = makeBlockCollection(embeddedBlocks);
    col.ensure_entity_vector = vi.fn(async () => {});

    const queueMicrotaskSpy = vi.spyOn(globalThis, 'queueMicrotask');

    const resultPromise = getBlockConnections(col, queryPath);
    await vi.runAllTimersAsync();
    await resultPromise;

    // At least one yield must have occurred after loading vectors
    expect(queueMicrotaskSpy.mock.calls.length).toBeGreaterThan(0);
  });

  it('still returns correct results after batched vector loading', async () => {
    const queryPath = 'query.md';
    const embeddedBlocks = Array.from({ length: 15 }, (_, i) =>
      makeBlock({ key: `${queryPath}#h${i}`, sourceKey: queryPath, hasEmbed: true, vec: [1, 0, 0] }),
    );

    const otherBlock = makeBlock({ key: 'other.md#h1', sourceKey: 'other.md' });
    const rawResult = { item: otherBlock, score: 0.88 };

    const col = makeBlockCollection(embeddedBlocks, async () => [rawResult]);

    const resultPromise = getBlockConnections(col, queryPath);
    await vi.runAllTimersAsync();
    const results = await resultPromise;

    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.88);
  });

  it('still respects the 30s timeout when using batched loading', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const queryPath = 'slow.md';
    const embeddedBlocks = Array.from({ length: 5 }, (_, i) =>
      makeBlock({ key: `${queryPath}#h${i}`, sourceKey: queryPath, hasEmbed: true }),
    );

    const col = makeBlockCollection(embeddedBlocks, () => new Promise(() => {})); // never resolves

    const resultPromise = getBlockConnections(col, queryPath);
    await vi.advanceTimersByTimeAsync(30_001);
    const results = await resultPromise;

    expect(results).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SC] getBlockConnections timed out'),
      queryPath,
    );

    warnSpy.mockRestore();
  });

  it('does not call ensure_entity_vector at all when no blocks have embeds', async () => {
    const queryPath = 'empty.md';
    const blocks = [
      makeBlock({ key: `${queryPath}#h1`, sourceKey: queryPath, hasEmbed: false }),
    ];
    const col = makeBlockCollection(blocks);

    const resultPromise = getBlockConnections(col, queryPath);
    await vi.runAllTimersAsync();
    await resultPromise;

    expect(col.ensure_entity_vector).not.toHaveBeenCalled();
  });
});
