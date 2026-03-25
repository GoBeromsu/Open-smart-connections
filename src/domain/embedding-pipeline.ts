/**
 * @file embedding-pipeline.ts
 * @description Batch embedding processor with concurrent API calls and single retry layer.
 *
 * Phase 3: Single retry policy — only this file retries. Adapters throw typed errors.
 *   - TransientError (429/5xx/network) → exponential backoff retry up to max_retries
 *   - FatalError (4xx auth/client) → immediate failure, no retry
 *   - Unknown errors → treated as transient (retried)
 *
 * Phase 4: Concurrent batch processing with configurable concurrency limit.
 */

import type { EmbeddingEntity } from '../types/entities';
import type { EmbedModelAdapter, EmbedResult } from '../types/models';
import { create_hash } from '../utils';
// FatalError is checked by name (error.name === 'FatalError') to support both direct import
// and test stubs. No import needed since instanceof is not used.

class BatchIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BatchIntegrityError';
  }
}

/**
 * Embedding queue statistics
 */
export interface EmbedQueueStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  duration_ms: number;
  outcome: EmbedRunOutcome;
  error?: string;
}

export type EmbedRunOutcome = 'completed' | 'halted' | 'failed';

/**
 * Embedding pipeline options
 */
export interface EmbedPipelineOptions {
  /** Batch size for embedding (default 10) */
  batch_size?: number;

  /** Maximum retries for transient errors (default 3) */
  max_retries?: number;

  /** Concurrency limit for parallel batch processing (default 1) */
  concurrency?: number;

  /** Callback for progress updates */
  on_progress?: (
    current: number,
    total: number,
    progress?: EmbedProgressSnapshot,
  ) => void;

  /** Callback to save after N batches (default: every 50 batches) */
  on_save?: () => Promise<void>;

  /** Save interval in batches (default 50) */
  save_interval?: number;

  /** Expected content hashes for hash re-verification (entityKey -> hash) */
  expected_hashes?: Record<string, string>;
}

export interface EmbedProgressSnapshot {
  current_key: string | null;
  current_source_path: string | null;
}

/**
 * Embedding pipeline for batch processing entities.
 * Single retry layer with typed error classification and concurrent batch dispatch.
 */
export class EmbeddingPipeline {
  private model: EmbedModelAdapter;
  private is_processing: boolean = false;
  private should_halt: boolean = false;
  private stats: EmbedQueueStats = {
    total: 0,
    success: 0,
    failed: 0,
    skipped: 0,
    duration_ms: 0,
    outcome: 'completed',
  };

  constructor(model: EmbedModelAdapter) {
    this.model = model;
  }

  /**
   * Process embedding queue for a collection of entities
   */
  async process(
    entities: EmbeddingEntity[],
    opts: EmbedPipelineOptions = {},
  ): Promise<EmbedQueueStats> {
    if (this.is_processing) {
      throw new Error('Embedding pipeline is already processing');
    }

    this.is_processing = true;
    this.should_halt = false;
    this.reset_stats();

    const {
      batch_size = 10,
      max_retries = 3,
      concurrency = 1,
      on_progress,
      on_save,
      save_interval = 50,
      expected_hashes,
    } = opts;

    const start_time = Date.now();

    try {
      const to_embed = entities.filter(e => e._queue_embed);
      this.stats.total = to_embed.length;

      if (to_embed.length === 0) {
        this.stats.duration_ms = Date.now() - start_time;
        return this.stats;
      }

      // Split into batch groups
      const batches: EmbeddingEntity[][] = [];
      for (let i = 0; i < to_embed.length; i += batch_size) {
        batches.push(to_embed.slice(i, i + batch_size));
      }

      let batches_since_save = 0;
      let entities_processed = 0;
      let save_chain: Promise<void> = Promise.resolve();
      let fatal_error: Error | null = null;

      const mark_fatal = (error: unknown): void => {
        if (!fatal_error) {
          fatal_error = error instanceof Error ? error : new Error(String(error));
        }
        this.should_halt = true;
      };

      const pendingEviction: EmbeddingEntity[] = [];

      const flush_save = async (): Promise<void> => {
        if (!on_save) return;
        const run = save_chain.then(() => on_save());
        save_chain = run.catch(() => undefined);
        await run;
        // Evict vectors for entities persisted in this save
        const toEvict = pendingEviction.splice(0);
        for (const entity of toEvict) {
          entity.evictVec?.();
        }
      };

      // Concurrent batch dispatcher
      const effective_concurrency = Math.max(1, concurrency);
      let batch_index = 0;

      interface WorkerCounts { success: number; failed: number; skipped: number; batches: number }

      const claim_remaining = (): number => {
        if (batch_index >= batches.length) return 0;
        let skipped = 0;
        for (let i = batch_index; i < batches.length; i++) {
          skipped += batches[i].length;
        }
        batch_index = batches.length;
        return skipped;
      };

      const process_next_batch = async (): Promise<WorkerCounts> => {
        const local: WorkerCounts = { success: 0, failed: 0, skipped: 0, batches: 0 };

        while (batch_index < batches.length) {
          if (fatal_error) {
            local.skipped += claim_remaining();
            return local;
          }

          if (this.should_halt) {
            local.skipped += claim_remaining();
            return local;
          }

          const current_batch_index = batch_index++;
          const batch = batches[current_batch_index];

          // Prepare embed inputs for this batch
          await Promise.all(batch.map(e => e.get_embed_input()));

          // Hash re-verification: skip entities whose content changed since queuing
          const { passed: hash_filtered, skipped_count: hash_skipped } =
            this.filter_by_hash(batch, expected_hashes);
          local.skipped += hash_skipped;

          const ready = hash_filtered.filter(e => e._embed_input && e._embed_input.length > 0);
          const skipped_in_batch = hash_filtered.filter(e => !ready.includes(e));

          if (ready.length === 0) {
            local.skipped += skipped_in_batch.length;
            this.clear_queue_flags(skipped_in_batch);
            entities_processed += batch.length;
            if (on_progress) {
              on_progress(
                entities_processed,
                to_embed.length,
                this.to_progress_snapshot(batch[batch.length - 1]),
              );
            }
            continue;
          }

          try {
            const { succeeded, failed_count } = await this.process_batch(ready, max_retries, pendingEviction);
            local.success += succeeded;
            local.failed += failed_count;
            local.skipped += skipped_in_batch.length;
            this.clear_queue_flags(skipped_in_batch);

          } catch (error) {
            local.failed += batch.length;
            const batch_error = this.wrap_batch_error(error, batch, max_retries);
            console.error(`[SC][Embed] ${batch_error.message}`);
            mark_fatal(batch_error);
            continue;
          }

          entities_processed += batch.length;
          if (on_progress) {
            on_progress(
              entities_processed,
              to_embed.length,
              this.to_progress_snapshot(ready[ready.length - 1]),
            );
          }

          // Periodic save
          local.batches++;
          batches_since_save++;
          if (on_save && batches_since_save >= save_interval) {
            batches_since_save = 0;
            try {
              await flush_save();
            } catch (error) {
              mark_fatal(error);
            }
          }
        }

        return local;
      };

      // Launch concurrent workers and merge counts after all complete
      const workers: Promise<WorkerCounts>[] = [];
      for (let w = 0; w < effective_concurrency; w++) {
        workers.push(process_next_batch());
      }
      const workerResults = await Promise.all(workers);
      for (const r of workerResults) {
        this.stats.success += r.success;
        this.stats.failed += r.failed;
        this.stats.skipped += r.skipped;
      }

      // Final save
      // Persist any successful batches even if a later batch failed, so API
      // runs do not lose partial progress when we surface the error.
      if (on_save && batches_since_save > 0) {
        batches_since_save = 0;
        try {
          await flush_save();
        } catch (error) {
          mark_fatal(error);
        }
      }

      if (on_save) {
        await save_chain;
      }

      if (fatal_error) {
        this.stats.outcome = 'failed';
        this.stats.error = (fatal_error as Error).message;
      } else if (this.should_halt) {
        this.stats.outcome = 'halted';
      } else {
        this.stats.outcome = 'completed';
      }
      this.stats.duration_ms = Date.now() - start_time;
      return this.stats;
    } finally {
      this.is_processing = false;
    }
  }

  /**
   * Filter entities by expected hash. Entities whose current hash doesn't match
   * the expected hash are skipped (content changed since queuing).
   */
  private filter_by_hash(
    batch: EmbeddingEntity[],
    expected_hashes?: Record<string, string>,
  ): { passed: EmbeddingEntity[]; skipped_count: number } {
    if (!expected_hashes) return { passed: batch, skipped_count: 0 };

    let skipped_count = 0;
    const passed = batch.filter(entity => {
      const expected = expected_hashes[entity.key];
      if (expected === undefined) return true;
      const current = entity.data.last_read?.hash;
      if (current !== expected) {
        skipped_count++;
        this.clear_queue_flags([entity]);
        return false;
      }
      return true;
    });

    return { passed, skipped_count };
  }

  /**
   * Process a single batch of entities with typed error classification.
   *
   * Single retry layer:
   * - FatalError → immediate failure, no retry
   * - TransientError → exponential backoff retry, respects retryAfterMs
   * - Unknown errors → treated as transient (retried)
   */
  private async process_batch(
    batch: EmbeddingEntity[],
    max_retries: number,
    pendingEviction?: EmbeddingEntity[],
  ): Promise<{ succeeded: number; failed_count: number }> {
    let retries = 0;
    let last_error: Error | null = null;

    while (retries <= max_retries) {
      try {
        const inputs = batch.map((entity, index) => ({
          embed_input: entity._embed_input!,
          key: entity.key,
          index,
        }));
        const embeddings: EmbedResult[] = await this.model.embed_batch(inputs);
        const embeddings_by_entity = this.index_results(batch, embeddings);

        // Assign embeddings to entities, validating vec
        let succeeded = 0;
        let failed_count = 0;
        const updatedAt = Date.now();

        for (const entity of batch) {
          const emb = embeddings_by_entity.get(entity.key);
          if (!emb) {
            failed_count++;
            continue;
          }

          // Null vec guard: reject null/empty vec (prevents silent data corruption)
          if (!emb.vec || emb.vec.length === 0) {
            failed_count++;
            continue;
          }

          entity.vec = emb.vec;
          entity.tokens = emb.tokens;
          pendingEviction?.push(entity);

          if (entity.data.last_read) {
            entity.data.last_embed = { ...entity.data.last_read };
            entity.set_active_embedding_meta({
              hash: entity.data.last_read.hash,
              size: entity.data.last_read.size,
              mtime: entity.data.last_read.mtime,
              dims: this.model.dims,
              adapter: this.model.adapter,
              updated_at: updatedAt,
            });
          } else if (entity._embed_input) {
            // No last_read: synthesize hash from embed input to prevent infinite re-embed loop
            const syntheticHash = await create_hash(entity._embed_input);
            entity.data.last_read = { hash: syntheticHash };
            entity.data.last_embed = { hash: syntheticHash };
            entity.set_active_embedding_meta({
              hash: syntheticHash,
              dims: this.model.dims,
              adapter: this.model.adapter,
              updated_at: updatedAt,
            });
          }

          succeeded++;
        }

        if (succeeded === 0 && failed_count > 0) {
          throw new Error('Embedding adapter returned no usable vectors for this batch');
        }

        // Clear queue flags for successful entities
        batch.forEach((entity) => {
          const emb = embeddings_by_entity.get(entity.key);
          if (emb?.vec && emb.vec.length > 0) {
            entity._queue_embed = false;
            entity._embed_input = null;
          }
        });

        return { succeeded, failed_count };
      } catch (error) {
        // FatalError: immediate failure, no retry
        if (error instanceof Error && (error.name === 'FatalError' || error.name === 'BatchIntegrityError')) {
          throw error;
        }

        // TransientError or unknown error: retry with backoff
        last_error = error as Error;
        retries++;

        if (retries <= max_retries) {
          const backoff_ms = this.compute_backoff(retries, error);
          await new Promise(resolve => setTimeout(resolve, backoff_ms));
        }
      }
    }

    // All retries exhausted. Preserve queue flags so the user can retry after
    // fixing the API issue instead of silently dropping the batch.
    throw this.create_retry_exhausted_error(last_error, max_retries);
  }

  /**
   * Compute backoff delay for retry.
   * Uses server-specified retryAfterMs if available, otherwise exponential backoff.
   */
  private compute_backoff(retry_number: number, error: unknown): number {
    // Check for server-specified retry delay
    if (
      error &&
      typeof error === 'object' &&
      'retryAfterMs' in error &&
      typeof (error as { retryAfterMs: unknown }).retryAfterMs === 'number'
    ) {
      return (error as { retryAfterMs: number }).retryAfterMs;
    }
    return Math.pow(2, retry_number) * 1000;
  }

  /**
   * Halt the current processing.
   * The pipeline will stop scheduling new batches but completes in-flight ones.
   */
  halt(): void {
    this.should_halt = true;
  }

  /**
   * Check if pipeline is currently processing
   */
  is_active(): boolean {
    return this.is_processing;
  }

  /**
   * Get current statistics
   */
  get_stats(): EmbedQueueStats {
    return { ...this.stats };
  }

  private reset_stats(): void {
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      duration_ms: 0,
      outcome: 'completed',
      error: undefined,
    };
  }

  private index_results(
    batch: EmbeddingEntity[],
    embeddings: EmbedResult[],
  ): Map<string, EmbedResult> {
    if (embeddings.length !== batch.length) {
      throw new BatchIntegrityError(
        `Embedding adapter returned ${embeddings.length} results for ${batch.length} inputs`,
      );
    }

    const expected_keys = new Set(batch.map(entity => entity.key));
    const keyed_results = new Map<string, EmbedResult>();

    for (const result of embeddings) {
      const result_index =
        typeof result.index === 'number' && Number.isInteger(result.index)
          ? result.index
          : null;
      const result_key =
        typeof result.key === 'string' && result.key.length > 0
          ? result.key
          : result_index !== null
            ? batch[result_index]?.key ?? null
            : null;

      if (!result_key) {
        throw new BatchIntegrityError('Embedding adapter result is missing key/index identity');
      }

      if (!expected_keys.has(result_key)) {
        throw new BatchIntegrityError(`Embedding adapter returned an unknown entity key: ${result_key}`);
      }

      if (result_index !== null && batch[result_index]?.key !== result_key) {
        throw new BatchIntegrityError(
          `Embedding adapter result identity mismatch for index ${result_index}: ${result_key}`,
        );
      }

      if (keyed_results.has(result_key)) {
        throw new BatchIntegrityError(`Embedding adapter returned duplicate results for entity: ${result_key}`);
      }

      keyed_results.set(result_key, result);
    }

    if (keyed_results.size !== batch.length) {
      throw new BatchIntegrityError(
        `Embedding adapter result identity mismatch: expected ${batch.length} unique entities, received ${keyed_results.size}`,
      );
    }

    return keyed_results;
  }

  private clear_queue_flags(entities: EmbeddingEntity[]): void {
    for (const entity of entities) {
      entity._queue_embed = false;
      entity._embed_input = null;
    }
  }

  private create_retry_exhausted_error(last_error: Error | null, max_retries: number): Error {
    const error = new Error(
      `Failed to embed batch after ${max_retries} retries: ${last_error?.message ?? 'unknown error'}`,
    );

    if (last_error instanceof Error) {
      error.name = last_error.name;
      const last_ext = last_error as Error & { status?: unknown; retryAfterMs?: unknown };
      if (typeof last_ext.status === 'number') {
        (error as Error & { status?: number }).status = last_ext.status;
      }
      if (typeof last_ext.retryAfterMs === 'number') {
        (error as Error & { retryAfterMs?: number }).retryAfterMs = last_ext.retryAfterMs;
      }
    }

    return error;
  }

  private wrap_batch_error(
    error: unknown,
    batch: EmbeddingEntity[],
    max_retries: number,
  ): Error {
    const exhausted = error instanceof Error
      ? error
      : this.create_retry_exhausted_error(new Error(String(error)), max_retries);
    const first_key = batch[0]?.key ?? 'unknown';
    const batch_error = new Error(
      `Embedding batch failed (${this.model.adapter}/${this.model.model_key}) after ${max_retries} retries ` +
      `[first=${first_key}, size=${batch.length}]: ${exhausted.message}`,
    );

    batch_error.name = exhausted.name || 'Error';
    const exhausted_ext = exhausted as Error & { status?: unknown; retryAfterMs?: unknown };
    if (typeof exhausted_ext.status === 'number') {
      (batch_error as Error & { status?: number }).status = exhausted_ext.status;
    }
    if (typeof exhausted_ext.retryAfterMs === 'number') {
      (batch_error as Error & { retryAfterMs?: number }).retryAfterMs = exhausted_ext.retryAfterMs;
    }

    return batch_error;
  }

  private to_progress_snapshot(entity?: EmbeddingEntity): EmbedProgressSnapshot {
    if (!entity) {
      return { current_key: null, current_source_path: null };
    }
    const current_key = entity.key ?? null;
    const current_source_path = current_key ? current_key.split('#')[0] : null;
    return { current_key, current_source_path };
  }
}
