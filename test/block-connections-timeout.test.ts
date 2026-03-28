/**
 * @file block-connections-timeout.test.ts
 * @description Tests for the Promise.race timeout guard and cache in getBlockConnections,
 *              and the scheduleRetryIfStale render-generation guard in ConnectionsView.
 *
 * Covers:
 *   getBlockConnections:
 *   - returns [] immediately when there are no embedded blocks
 *   - returns [] and logs a warning when the 30s timeout fires before nearest() resolves
 *   - returns results normally when nearest() resolves before timeout
 *   - dedupes results by source path, keeping the highest-scoring block
 *   - serves results from cache on a second call within TTL
 *   - invalidateConnectionsCache(path) evicts only the specified path
 *   - invalidateConnectionsCache() with no arg clears all cached paths
 *
 *   scheduleRetryIfStale (ConnectionsView):
 *   - returns false and does not schedule a retry when gen matches _renderGen
 *   - returns true and schedules exactly one retry when gen is stale
 *   - does not schedule a second retry if one is already pending
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getBlockConnections, invalidateConnectionsCache } from '../src/ui/block-connections';
import { ConnectionsView } from '../src/ui/ConnectionsView';

// ── Fake timers ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  // Always start with a clean cache between tests
  invalidateConnectionsCache();
});

afterEach(() => {
  vi.useRealTimers();
  invalidateConnectionsCache();
});

// ── BlockCollection stub ──────────────────────────────────────────────────────

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

// ── getBlockConnections — basic paths ─────────────────────────────────────────

describe('getBlockConnections', () => {
  it('returns empty array when there are no embedded blocks for the file', async () => {
    const col = makeBlockCollection([]);

    const results = await getBlockConnections(col, 'note.md');

    expect(results).toEqual([]);
    expect(col.nearest).not.toHaveBeenCalled();
  });

  it('returns empty array when blocks exist but none have embed', async () => {
    const block = makeBlock({ key: 'note.md#h1', sourceKey: 'note.md', hasEmbed: false });
    const col = makeBlockCollection([block]);

    const results = await getBlockConnections(col, 'note.md');

    expect(results).toEqual([]);
    expect(col.nearest).not.toHaveBeenCalled();
  });

  it('returns results and calls nearest() when embedded blocks are present', async () => {
    const block = makeBlock({ key: 'note.md#h1', sourceKey: 'note.md', hasEmbed: true, vec: [1, 0, 0] });
    const rawResult = { item: makeBlock({ key: 'other.md#h1', sourceKey: 'other.md' }), score: 0.9 };
    const col = makeBlockCollection([block], async () => [rawResult]);

    const results = await getBlockConnections(col, 'note.md');
    // Resolve any pending microtasks / timers so nearest() completes
    await vi.runAllTimersAsync();

    expect(col.nearest).toHaveBeenCalled();
    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.9);
  });

  it('dedupes results by source path keeping the highest-scoring block', async () => {
    const block = makeBlock({ key: 'note.md#h1', sourceKey: 'note.md', hasEmbed: true, vec: [1, 0, 0] });
    const resultA = { item: makeBlock({ key: 'other.md#h1', sourceKey: 'other.md' }), score: 0.7 };
    const resultB = { item: makeBlock({ key: 'other.md#h2', sourceKey: 'other.md' }), score: 0.95 };
    const col = makeBlockCollection([block], async () => [resultA, resultB]);

    const results = await getBlockConnections(col, 'note.md');
    await vi.runAllTimersAsync();

    expect(results).toHaveLength(1);
    expect(results[0].score).toBe(0.95);
  });

  it('excludes results that belong to the query file itself', async () => {
    const block = makeBlock({ key: 'note.md#h1', sourceKey: 'note.md', hasEmbed: true, vec: [1, 0, 0] });
    // nearest() returns a block from the same file — should be filtered out
    const selfResult = { item: makeBlock({ key: 'note.md#h2', sourceKey: 'note.md' }), score: 0.99 };
    const col = makeBlockCollection([block], async () => [selfResult]);

    const results = await getBlockConnections(col, 'note.md');
    await vi.runAllTimersAsync();

    expect(results).toHaveLength(0);
  });

  it('returns [] and logs a warning when the 30s timeout fires before nearest() resolves', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const block = makeBlock({ key: 'note.md#h1', sourceKey: 'note.md', hasEmbed: true, vec: [1, 0, 0] });
    // nearest() never resolves during the test
    const col = makeBlockCollection([block], () => new Promise(() => {}));

    const resultPromise = getBlockConnections(col, 'note.md');

    // Advance past the 30s EMBED_TIMEOUT_MS
    await vi.advanceTimersByTimeAsync(30_001);
    const results = await resultPromise;

    expect(results).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[SC] getBlockConnections timed out'),
      'note.md',
    );

    warnSpy.mockRestore();
  });

  // ── Cache behaviour ────────────────────────────────────────────────────────

  it('serves results from cache on a second call within TTL', async () => {
    const block = makeBlock({ key: 'note.md#h1', sourceKey: 'note.md', hasEmbed: true, vec: [1, 0, 0] });
    const rawResult = { item: makeBlock({ key: 'other.md#h1', sourceKey: 'other.md' }), score: 0.8 };
    const col = makeBlockCollection([block], async () => [rawResult]);

    // First call — populates cache
    await getBlockConnections(col, 'note.md');
    await vi.runAllTimersAsync();

    // Second call — should hit cache, nearest() not called again
    await getBlockConnections(col, 'note.md');

    // nearest was called only once across both invocations
    expect(col.nearest).toHaveBeenCalledTimes(1);
  });

  it('invalidateConnectionsCache(path) evicts only the specified path', async () => {
    const blockA = makeBlock({ key: 'a.md#h1', sourceKey: 'a.md', hasEmbed: true, vec: [1, 0, 0] });
    const blockB = makeBlock({ key: 'b.md#h1', sourceKey: 'b.md', hasEmbed: true, vec: [0, 1, 0] });
    const rawA = { item: makeBlock({ key: 'other.md#h1', sourceKey: 'other.md' }), score: 0.8 };
    const rawB = { item: makeBlock({ key: 'other.md#h1', sourceKey: 'other.md' }), score: 0.7 };
    const col = makeBlockCollection([blockA, blockB], async () => [rawA, rawB]);

    // Populate cache for both paths
    await getBlockConnections(col, 'a.md');
    await getBlockConnections(col, 'b.md');
    await vi.runAllTimersAsync();
    expect(col.nearest).toHaveBeenCalledTimes(2);

    // Evict only a.md
    invalidateConnectionsCache('a.md');

    // Re-fetch: a.md must hit nearest() again, b.md must still be cached
    await getBlockConnections(col, 'a.md');
    await getBlockConnections(col, 'b.md');
    await vi.runAllTimersAsync();

    expect(col.nearest).toHaveBeenCalledTimes(3); // one extra for a.md
  });

  it('invalidateConnectionsCache() with no argument clears all cached paths', async () => {
    const blockA = makeBlock({ key: 'a.md#h1', sourceKey: 'a.md', hasEmbed: true, vec: [1, 0, 0] });
    const rawA = { item: makeBlock({ key: 'other.md#h1', sourceKey: 'other.md' }), score: 0.8 };
    const col = makeBlockCollection([blockA], async () => [rawA]);

    await getBlockConnections(col, 'a.md');
    await vi.runAllTimersAsync();
    expect(col.nearest).toHaveBeenCalledTimes(1);

    invalidateConnectionsCache(); // clear all

    await getBlockConnections(col, 'a.md');
    await vi.runAllTimersAsync();

    expect(col.nearest).toHaveBeenCalledTimes(2);
  });
});

// ── scheduleRetryIfStale ──────────────────────────────────────────────────────

describe('ConnectionsView.scheduleRetryIfStale', () => {
  function makeView(): any {
    const view = Object.create(ConnectionsView.prototype);
    view._renderGen = 1;
    view._pendingRetry = null;
    view.lastRenderedPath = null;
    // renderView is called by the retry timeout — stub it out
    view.renderView = vi.fn(async () => {});
    return view;
  }

  it('returns false when gen matches _renderGen (render is current)', () => {
    const view = makeView();
    view._renderGen = 5;

    const stale = (view as any).scheduleRetryIfStale(5);

    expect(stale).toBe(false);
    expect(view._pendingRetry).toBeNull();
  });

  it('returns true when gen is behind _renderGen (render is stale)', () => {
    const view = makeView();
    view._renderGen = 5;

    const stale = (view as any).scheduleRetryIfStale(3);

    expect(stale).toBe(true);
  });

  it('schedules a window.setTimeout retry when gen is stale', () => {
    const view = makeView();
    view._renderGen = 2;

    (view as any).scheduleRetryIfStale(1);

    expect(view._pendingRetry).not.toBeNull();
  });

  it('calls renderView after the 150ms debounce fires', async () => {
    const view = makeView();
    view._renderGen = 2;

    (view as any).scheduleRetryIfStale(1);
    await vi.advanceTimersByTimeAsync(150);

    expect(view.renderView).toHaveBeenCalledTimes(1);
    expect(view._pendingRetry).toBeNull();
  });

  it('does not schedule a second retry when one is already pending', () => {
    const view = makeView();
    view._renderGen = 3;

    (view as any).scheduleRetryIfStale(1); // schedules first
    const firstToken = view._pendingRetry;

    (view as any).scheduleRetryIfStale(2); // should reuse existing

    expect(view._pendingRetry).toBe(firstToken);
  });

  it('clears _pendingRetry to null after the timeout callback executes', async () => {
    const view = makeView();
    view._renderGen = 2;

    (view as any).scheduleRetryIfStale(1);
    expect(view._pendingRetry).not.toBeNull();

    await vi.advanceTimersByTimeAsync(200);

    expect(view._pendingRetry).toBeNull();
  });
});
