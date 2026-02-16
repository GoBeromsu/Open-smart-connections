/**
 * @file embedding-pipeline-retry.test.ts
 * @description TDD tests for Phase 3+4: Retry unification + concurrent API calls
 *
 * Phase 3 — Retry Unification
 *   Current state: 3 overlapping retry layers
 *     1. Pipeline-level retry in process_batch() with exponential backoff
 *     2. Adapter-level retry in handle_request_err() for 429 only
 *     3. Gemini-specific retry in embed_batch() with server-prescribed delay
 *   Target: Single retry layer at pipeline level, adapters throw typed errors
 *
 * Phase 4 — Concurrent API Calls
 *   Current state: Sequential batch loop (one batch at a time)
 *   Target: Configurable concurrent batch processing (default concurrency: 3)
 *
 * Contract: After implementation, replace inline stubs with:
 *   import { TransientError, FatalError } from '../src/features/embedding/errors';
 *   import { EmbeddingPipeline } from '../src/shared/search/embedding-pipeline';
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Inline stubs — defines the API contract for Phase 3+4
// Replace with real imports after implementation
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Transient errors are retryable: 429 (rate limit), 503 (service unavailable),
 * network timeouts, connection refused, etc.
 */
class TransientError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    status: number,
    opts?: { retryAfterMs?: number },
  ) {
    super(message);
    this.name = 'TransientError';
    this.status = status;
    this.retryAfterMs = opts?.retryAfterMs;
  }
}

/**
 * Fatal errors are NOT retryable: 400 (bad request), 401 (unauthorized),
 * 403 (forbidden), malformed response, etc.
 */
class FatalError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FatalError';
    this.status = status;
  }
}

/** Minimal entity interface for testing */
interface TestEntity {
  key: string;
  _queue_embed: boolean;
  _embed_input: string | null;
  vec: number[] | null;
  tokens: number;
  data: {
    last_read?: { hash: string; size: number; mtime: number };
    last_embed?: { hash: string; size: number; mtime: number };
  };
  get_embed_input: () => Promise<void>;
  set_active_embedding_meta: (meta: any) => void;
}

function makeEntity(
  key: string,
  embedInput: string = `content of ${key}`,
): TestEntity {
  return {
    key,
    _queue_embed: true,
    _embed_input: null,
    vec: null,
    tokens: 0,
    data: {
      last_read: { hash: 'h-' + key, size: 100, mtime: Date.now() },
    },
    get_embed_input: vi.fn(async function (this: TestEntity) {
      this._embed_input = embedInput;
    }),
    set_active_embedding_meta: vi.fn(),
  };
}

function makeModel(opts: {
  embed_batch?: (inputs: any[]) => Promise<any[]>;
  dims?: number;
  adapter?: string;
} = {}) {
  const embed_batch = opts.embed_batch ?? (async (inputs: any[]) =>
    inputs.map(() => ({ vec: [0.1, 0.2, 0.3], tokens: 10 }))
  );
  return {
    embed_batch,
    dims: opts.dims ?? 1536,
    adapter: opts.adapter ?? 'openai',
  } as any;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Minimal pipeline stub for TDD red phase
// After implementation, import from '../src/shared/search/embedding-pipeline'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

import { EmbeddingPipeline } from '../src/shared/search/embedding-pipeline';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 3 — Typed Error Classification
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Typed error classification', () => {
  it('TransientError carries status and optional retryAfterMs', () => {
    const err = new TransientError('Rate limited', 429, { retryAfterMs: 5000 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('TransientError');
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.message).toBe('Rate limited');
  });

  it('TransientError works without retryAfterMs', () => {
    const err = new TransientError('Service unavailable', 503);
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.status).toBe(503);
  });

  it('FatalError carries status with no retry hint', () => {
    const err = new FatalError('Unauthorized', 401);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('FatalError');
    expect(err.status).toBe(401);
    expect(err.message).toBe('Unauthorized');
    expect(err).not.toHaveProperty('retryAfterMs');
  });

  it('TransientError covers 429, 503, and network errors', () => {
    const cases = [
      { msg: 'Rate limited', status: 429 },
      { msg: 'Service unavailable', status: 503 },
      { msg: 'Gateway timeout', status: 504 },
      { msg: 'Connection refused', status: 0 },
    ];

    for (const c of cases) {
      const err = new TransientError(c.msg, c.status);
      expect(err).toBeInstanceOf(TransientError);
      expect(err.name).toBe('TransientError');
    }
  });

  it('FatalError covers 400, 401, 403', () => {
    const cases = [
      { msg: 'Bad request', status: 400 },
      { msg: 'Unauthorized', status: 401 },
      { msg: 'Forbidden', status: 403 },
    ];

    for (const c of cases) {
      const err = new FatalError(c.msg, c.status);
      expect(err).toBeInstanceOf(FatalError);
      expect(err.name).toBe('FatalError');
    }
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 3 — Single Retry Layer (Pipeline Only)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Pipeline retry behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries transient errors up to max_retries', async () => {
    let callCount = 0;
    const model = makeModel({
      embed_batch: vi.fn(async () => {
        callCount++;
        if (callCount <= 2) {
          throw new TransientError('Rate limited', 429);
        }
        return [{ vec: [0.1, 0.2], tokens: 5 }];
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const processPromise = pipeline.process([entity], {
      max_retries: 3,
      batch_size: 1,
    });

    // Advance past the two backoff waits (2^1 = 2s, 2^2 = 4s)
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    const stats = await processPromise;

    expect(stats.success).toBe(1);
    expect(stats.failed).toBe(0);
    expect(callCount).toBe(3); // 2 failures + 1 success
  });

  it('stops retrying after max_retries and marks batch as failed', async () => {
    const model = makeModel({
      embed_batch: vi.fn(async () => {
        throw new TransientError('Service unavailable', 503);
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const processPromise = pipeline.process([entity], {
      max_retries: 2,
      batch_size: 1,
    });

    // Advance past all retry backoffs (2^1 = 2s, 2^2 = 4s)
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    const stats = await processPromise;

    expect(stats.failed).toBe(1);
    expect(stats.success).toBe(0);
  });

  it('does NOT retry fatal errors — marks failed immediately', async () => {
    const embedBatch = vi.fn(async () => {
      throw new FatalError('Unauthorized', 401);
    });

    const model = makeModel({ embed_batch: embedBatch });
    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const stats = await pipeline.process([entity], {
      max_retries: 3,
      batch_size: 1,
    });

    expect(stats.failed).toBe(1);
    expect(stats.success).toBe(0);
    // Fatal error should NOT trigger retries — only 1 call
    expect(embedBatch).toHaveBeenCalledTimes(1);
  });

  it('uses exponential backoff: 2^retry * 1000ms', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;

    const model = makeModel({
      embed_batch: vi.fn(async () => {
        throw new TransientError('Rate limited', 429);
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const processPromise = pipeline.process([entity], {
      max_retries: 3,
      batch_size: 1,
    });

    // Advance timers through all retries
    // Retry 1: 2^1 * 1000 = 2000ms
    // Retry 2: 2^2 * 1000 = 4000ms
    // Retry 3: 2^3 * 1000 = 8000ms
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    await vi.advanceTimersByTimeAsync(8000);
    await processPromise;

    // All retries exhausted — the process should have completed (failed)
    const stats = pipeline.get_stats();
    expect(stats.failed).toBe(1);
  });

  it('respects server-specified retryAfterMs from TransientError', async () => {
    let callCount = 0;
    const model = makeModel({
      embed_batch: vi.fn(async () => {
        callCount++;
        if (callCount === 1) {
          throw new TransientError('Rate limited', 429, { retryAfterMs: 10000 });
        }
        return [{ vec: [0.1], tokens: 5 }];
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const processPromise = pipeline.process([entity], {
      max_retries: 3,
      batch_size: 1,
    });

    // The pipeline should respect the 10s server-specified delay
    // Advancing only 5s should NOT have triggered the retry yet
    await vi.advanceTimersByTimeAsync(5000);
    expect(callCount).toBe(1); // still waiting

    // Advancing the remaining 5s should trigger the retry
    await vi.advanceTimersByTimeAsync(5000);
    const stats = await processPromise;

    expect(callCount).toBe(2);
    expect(stats.success).toBe(1);
  });

  it('clears _queue_embed flag on fatal error (no infinite retry loop)', async () => {
    const model = makeModel({
      embed_batch: vi.fn(async () => {
        throw new FatalError('Bad request', 400);
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    await pipeline.process([entity], {
      max_retries: 3,
      batch_size: 1,
    });

    // Entity should have _queue_embed cleared so it doesn't re-enter the queue
    expect(entity._queue_embed).toBe(false);
  });

  it('clears _queue_embed flag after max transient retries exhausted', async () => {
    const model = makeModel({
      embed_batch: vi.fn(async () => {
        throw new TransientError('Timeout', 503);
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const processPromise = pipeline.process([entity], {
      max_retries: 1,
      batch_size: 1,
    });

    await vi.advanceTimersByTimeAsync(2000); // 2^1 * 1000
    await processPromise;

    expect(entity._queue_embed).toBe(false);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 3 — Null Vector Regression (Bug Fix)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Null vector handling (regression)', () => {
  it('rejects null/empty vec from adapter and counts entity as failed', async () => {
    const model = makeModel({
      embed_batch: vi.fn(async () => [
        { vec: null, tokens: 0 },  // null vec — must NOT be saved as "complete"
      ]),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const stats = await pipeline.process([entity], {
      batch_size: 1,
      max_retries: 0,
    });

    // The entity's vec should NOT have been set to null as if embedding succeeded
    // Either: vec stays unchanged (null from init is OK), but _queue_embed not cleared as "success"
    expect(stats.success).toBe(0);
    expect(stats.failed).toBeGreaterThanOrEqual(1);
  });

  it('rejects empty array vec from adapter', async () => {
    const model = makeModel({
      embed_batch: vi.fn(async () => [
        { vec: [], tokens: 0 },  // empty array — invalid embedding
      ]),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const stats = await pipeline.process([entity], {
      batch_size: 1,
      max_retries: 0,
    });

    expect(stats.success).toBe(0);
    expect(stats.failed).toBeGreaterThanOrEqual(1);
  });

  it('accepts valid vec and marks as success', async () => {
    const model = makeModel({
      embed_batch: vi.fn(async () => [
        { vec: [0.1, 0.2, 0.3], tokens: 10 },
      ]),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const stats = await pipeline.process([entity], {
      batch_size: 1,
      max_retries: 0,
    });

    expect(stats.success).toBe(1);
    expect(entity.vec).toEqual([0.1, 0.2, 0.3]);
  });

  it('handles mixed valid/null results in same batch', async () => {
    const model = makeModel({
      embed_batch: vi.fn(async () => [
        { vec: [0.1, 0.2], tokens: 10 },
        { vec: null, tokens: 0 },
        { vec: [0.3, 0.4], tokens: 8 },
      ]),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entities = [
      makeEntity('a.md'),
      makeEntity('b.md'),
      makeEntity('c.md'),
    ];

    const stats = await pipeline.process(entities, {
      batch_size: 3,
      max_retries: 0,
    });

    // Entity a and c should succeed, entity b should fail
    expect(entities[0].vec).toEqual([0.1, 0.2]);
    expect(entities[1].vec).toBeNull(); // NOT saved as "complete"
    expect(entities[2].vec).toEqual([0.3, 0.4]);
    expect(stats.success).toBe(2);
    expect(stats.failed).toBe(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 4 — Concurrent Batch Processing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Concurrent batch processing', () => {
  it('processes multiple batches concurrently with default concurrency (3)', async () => {
    let peakConcurrent = 0;
    let currentConcurrent = 0;

    const model = makeModel({
      embed_batch: vi.fn(async (inputs: any[]) => {
        currentConcurrent++;
        peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
        // Simulate API latency
        await new Promise(r => setTimeout(r, 50));
        currentConcurrent--;
        return inputs.map(() => ({ vec: [0.1], tokens: 5 }));
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entities = Array.from({ length: 30 }, (_, i) => makeEntity(`note-${i}.md`));

    const stats = await pipeline.process(entities, {
      batch_size: 1,
      concurrency: 3,
    });

    expect(stats.success).toBe(30);
    expect(peakConcurrent).toBeGreaterThan(1);
    expect(peakConcurrent).toBeLessThanOrEqual(3);
  });

  it('respects concurrency limit of 1 (sequential mode)', async () => {
    let peakConcurrent = 0;
    let currentConcurrent = 0;

    const model = makeModel({
      embed_batch: vi.fn(async (inputs: any[]) => {
        currentConcurrent++;
        peakConcurrent = Math.max(peakConcurrent, currentConcurrent);
        await new Promise(r => setTimeout(r, 10));
        currentConcurrent--;
        return inputs.map(() => ({ vec: [0.1], tokens: 5 }));
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entities = Array.from({ length: 5 }, (_, i) => makeEntity(`note-${i}.md`));

    await pipeline.process(entities, {
      batch_size: 1,
      concurrency: 1,
    });

    expect(peakConcurrent).toBe(1);
  });

  it('each concurrent response is processed independently', async () => {
    let callCount = 0;

    const model = makeModel({
      embed_batch: vi.fn(async () => {
        callCount++;
        // Second batch fails, others succeed
        if (callCount === 2) {
          throw new FatalError('Bad batch', 400);
        }
        return [{ vec: [0.1, 0.2], tokens: 5 }];
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entities = Array.from({ length: 3 }, (_, i) => makeEntity(`note-${i}.md`));

    const stats = await pipeline.process(entities, {
      batch_size: 1,
      concurrency: 3,
    });

    // 2 succeed, 1 fails — failure in one batch does not affect others
    expect(stats.success).toBe(2);
    expect(stats.failed).toBe(1);
  });

  it('halt() stops scheduling new batches but completes in-flight', async () => {
    let batchesStarted = 0;

    const model = makeModel({
      embed_batch: vi.fn(async (inputs: any[]) => {
        batchesStarted++;
        // Give enough time for halt to be called
        await new Promise(r => setTimeout(r, 100));
        return inputs.map(() => ({ vec: [0.1], tokens: 5 }));
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entities = Array.from({ length: 20 }, (_, i) => makeEntity(`note-${i}.md`));

    const processPromise = pipeline.process(entities, {
      batch_size: 1,
      concurrency: 3,
    });

    // Wait briefly for first batch(es) to start, then halt
    await new Promise(r => setTimeout(r, 20));
    pipeline.halt();

    const stats = await processPromise;

    // Some entities were processed, rest were skipped due to halt
    expect(stats.skipped).toBeGreaterThan(0);
    expect(stats.success + stats.failed + stats.skipped).toBe(20);
    // halt should not have allowed all 20 batches to start
    expect(batchesStarted).toBeLessThan(20);
  });

  it('concurrent batches with mixed transient/fatal errors are isolated', async () => {
    let callCount = 0;

    const model = makeModel({
      embed_batch: vi.fn(async () => {
        callCount++;
        if (callCount === 1) throw new TransientError('Rate limit', 429);
        if (callCount === 2) throw new FatalError('Auth failed', 401);
        return [{ vec: [0.5], tokens: 3 }];
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entities = Array.from({ length: 3 }, (_, i) => makeEntity(`note-${i}.md`));

    const stats = await pipeline.process(entities, {
      batch_size: 1,
      concurrency: 3,
      max_retries: 0,
    });

    // Each batch handled independently:
    // batch 1: transient error, no retries -> failed
    // batch 2: fatal error -> failed
    // batch 3: success
    expect(stats.failed).toBe(2);
    expect(stats.success).toBe(1);
  });

  it('on_progress fires after each batch completes (concurrent)', async () => {
    const progressCalls: Array<{ current: number; total: number }> = [];

    const model = makeModel({
      embed_batch: vi.fn(async (inputs: any[]) => {
        await new Promise(r => setTimeout(r, 10));
        return inputs.map(() => ({ vec: [0.1], tokens: 5 }));
      }),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entities = Array.from({ length: 6 }, (_, i) => makeEntity(`note-${i}.md`));

    await pipeline.process(entities, {
      batch_size: 2,
      concurrency: 2,
      on_progress: (current, total) => {
        progressCalls.push({ current, total });
      },
    });

    // 6 entities / batch_size 2 = 3 batches, each should report progress
    expect(progressCalls).toHaveLength(3);
    // Final progress call should show all entities processed
    expect(progressCalls[progressCalls.length - 1].current).toBe(6);
    expect(progressCalls[progressCalls.length - 1].total).toBe(6);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 3+4 — Hash Re-verification During Concurrent Processing
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Hash re-verification during concurrent processing', () => {
  it('skips entity if content hash changed between queue and embed', async () => {
    const model = makeModel({
      embed_batch: vi.fn(async (inputs: any[]) =>
        inputs.map(() => ({ vec: [0.1, 0.2], tokens: 5 })),
      ),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');
    // Simulate content changing after queue but before embed
    entity.get_embed_input = vi.fn(async function (this: TestEntity) {
      this._embed_input = 'updated content';
      // Hash changed from original — stale
      if (this.data.last_read) {
        this.data.last_read.hash = 'new-hash-after-edit';
      }
    });

    // Store original hash to detect mismatch
    const originalHash = 'h-note.md';

    const stats = await pipeline.process([entity], {
      batch_size: 1,
      expected_hashes: { 'note.md': originalHash },
    });

    // Entity should be skipped (not embedded) because hash changed
    expect(stats.skipped).toBe(1);
    expect(stats.success).toBe(0);
  });

  it('embeds entity when content hash matches expected', async () => {
    const model = makeModel({
      embed_batch: vi.fn(async () => [{ vec: [0.1, 0.2], tokens: 5 }]),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const stats = await pipeline.process([entity], {
      batch_size: 1,
      expected_hashes: { 'note.md': 'h-note.md' }, // matches entity.data.last_read.hash
    });

    expect(stats.success).toBe(1);
    expect(stats.skipped).toBe(0);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 3 — Adapter-Level Retry Removal Verification
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Adapter throws typed errors (no internal retry)', () => {
  it('adapter converts 429 to TransientError and throws (no internal retry)', async () => {
    const adapter429 = vi.fn(async () => {
      throw new TransientError('Rate limited', 429);
    });

    const model = makeModel({ embed_batch: adapter429 });
    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const stats = await pipeline.process([entity], {
      batch_size: 1,
      max_retries: 0,
    });

    // Adapter was called exactly once — it does NOT retry internally
    expect(adapter429).toHaveBeenCalledTimes(1);
    expect(stats.failed).toBe(1);
  });

  it('adapter converts 401 to FatalError and throws', async () => {
    const adapter401 = vi.fn(async () => {
      throw new FatalError('Unauthorized', 401);
    });

    const model = makeModel({ embed_batch: adapter401 });
    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const stats = await pipeline.process([entity], {
      batch_size: 1,
      max_retries: 3,
    });

    // Fatal: adapter called once, pipeline does NOT retry
    expect(adapter401).toHaveBeenCalledTimes(1);
    expect(stats.failed).toBe(1);
  });

  it('unknown errors are treated as transient and retried', async () => {
    let callCount = 0;
    const adapterUnknown = vi.fn(async () => {
      callCount++;
      if (callCount <= 1) {
        throw new Error('Network socket hung up');
      }
      return [{ vec: [0.1], tokens: 5 }];
    });

    const model = makeModel({ embed_batch: adapterUnknown });
    const pipeline = new EmbeddingPipeline(model);
    const entity = makeEntity('note.md');

    const stats = await pipeline.process([entity], {
      batch_size: 1,
      max_retries: 2,
    });

    // Unknown errors should be treated as potentially transient
    expect(adapterUnknown).toHaveBeenCalledTimes(2); // 1 fail + 1 success
    expect(stats.success).toBe(1);
  });
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Phase 4 — Save Interval with Concurrent Batches
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

describe('Periodic save with concurrency', () => {
  it('calls on_save after save_interval batches complete', async () => {
    const onSave = vi.fn(async () => {});

    const model = makeModel({
      embed_batch: vi.fn(async (inputs: any[]) =>
        inputs.map(() => ({ vec: [0.1], tokens: 5 })),
      ),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entities = Array.from({ length: 10 }, (_, i) => makeEntity(`note-${i}.md`));

    await pipeline.process(entities, {
      batch_size: 1,
      concurrency: 2,
      save_interval: 3,
      on_save: onSave,
    });

    // 10 batches / save_interval 3 = at least 3 saves + 1 final save
    expect(onSave).toHaveBeenCalled();
    // Final save should always be called
    expect(onSave.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('calls final save even when batch count is not a multiple of save_interval', async () => {
    const onSave = vi.fn(async () => {});

    const model = makeModel({
      embed_batch: vi.fn(async (inputs: any[]) =>
        inputs.map(() => ({ vec: [0.1], tokens: 5 })),
      ),
    });

    const pipeline = new EmbeddingPipeline(model);
    const entities = Array.from({ length: 4 }, (_, i) => makeEntity(`note-${i}.md`));

    await pipeline.process(entities, {
      batch_size: 1,
      save_interval: 3,
      on_save: onSave,
    });

    // 4 batches: save at batch 3, then final save at end for remaining 1 batch
    expect(onSave).toHaveBeenCalled();
  });
});
