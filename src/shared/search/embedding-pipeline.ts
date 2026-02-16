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
// FatalError is checked by name to support both direct import and test stubs.
// Import for type reference only (not used for instanceof).
import type { FatalError as _FatalError } from '../errors';

/**
 * Embedding queue statistics
 */
export interface EmbedQueueStats {
  total: number;
  success: number;
  failed: number;
  skipped: number;
  duration_ms: number;
}

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

  /** Callback for batch complete */
  on_batch_complete?: (batch_num: number, batch_size: number) => void;

  /** Callback to save after N batches (default: every 50 batches) */
  on_save?: () => Promise<void>;

  /** Save interval in batches (default 50) */
  save_interval?: number;

  /** Whether to halt on error (default false) */
  halt_on_error?: boolean;

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
      on_batch_complete,
      on_save,
      save_interval = 50,
      halt_on_error = false,
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

      // Concurrent batch dispatcher
      const effective_concurrency = Math.max(1, concurrency);
      let batch_index = 0;

      const process_next_batch = async (): Promise<void> => {
        while (batch_index < batches.length) {
          if (this.should_halt) {
            // Count remaining unprocessed entities as skipped
            for (let i = batch_index; i < batches.length; i++) {
              this.stats.skipped += batches[i].length;
            }
            batch_index = batches.length;
            return;
          }

          const current_batch_index = batch_index++;
          const batch = batches[current_batch_index];
          const batch_num = current_batch_index + 1;

          // Prepare embed inputs for this batch
          await Promise.all(batch.map(e => e.get_embed_input()));

          // Hash re-verification: skip entities whose content changed since queuing
          const { passed: hash_filtered, skipped_count: hash_skipped } =
            this.filter_by_hash(batch, expected_hashes);
          this.stats.skipped += hash_skipped;

          const ready = hash_filtered.filter(e => e._embed_input && e._embed_input.length > 0);
          const skipped_in_batch = hash_filtered.filter(e => !ready.includes(e));

          if (ready.length === 0) {
            this.stats.skipped += skipped_in_batch.length;
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
            const { succeeded, failed_count } = await this.process_batch(ready, max_retries);
            this.stats.success += succeeded;
            this.stats.failed += failed_count;
            this.stats.skipped += skipped_in_batch.length;
            this.clear_queue_flags(skipped_in_batch);

            if (on_batch_complete) {
              on_batch_complete(batch_num, ready.length);
            }
          } catch (error) {
            this.stats.failed += batch.length;
            this.clear_queue_flags(batch);

            if (halt_on_error) {
              throw error;
            }
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
          batches_since_save++;
          if (on_save && batches_since_save >= save_interval) {
            await on_save();
            batches_since_save = 0;
          }
        }
      };

      // Launch concurrent workers
      const workers: Promise<void>[] = [];
      for (let w = 0; w < effective_concurrency; w++) {
        workers.push(process_next_batch());
      }
      await Promise.all(workers);

      // Final save
      if (on_save && batches_since_save > 0) {
        await on_save();
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
  ): Promise<{ succeeded: number; failed_count: number }> {
    let retries = 0;
    let last_error: Error | null = null;

    while (retries <= max_retries) {
      try {
        const inputs = batch.map(e => ({ _embed_input: e._embed_input! }));
        const embeddings: EmbedResult[] = await this.model.embed_batch(inputs);

        // Assign embeddings to entities, validating vec
        let succeeded = 0;
        let failed_count = 0;
        const updatedAt = Date.now();

        embeddings.forEach((emb, i) => {
          const entity = batch[i];

          // Null vec guard: reject null/empty vec (prevents silent data corruption)
          if (!emb.vec || emb.vec.length === 0) {
            failed_count++;
            return;
          }

          entity.vec = emb.vec;
          entity.tokens = emb.tokens;

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
          }

          succeeded++;
        });

        // Clear queue flags for successful entities
        batch.forEach((entity, i) => {
          const emb = embeddings[i];
          if (emb?.vec && emb.vec.length > 0) {
            entity._queue_embed = false;
            entity._embed_input = null;
          }
        });

        return { succeeded, failed_count };
      } catch (error) {
        // FatalError: immediate failure, no retry
        if (error instanceof Error && error.name === 'FatalError') {
          this.clear_queue_flags(batch);
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

    // All retries exhausted
    this.clear_queue_flags(batch);
    throw new Error(`Failed to embed batch after ${max_retries} retries: ${last_error?.message}`);
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
      typeof (error as any).retryAfterMs === 'number'
    ) {
      return (error as any).retryAfterMs;
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
    };
  }

  private clear_queue_flags(entities: EmbeddingEntity[]): void {
    for (const entity of entities) {
      entity._queue_embed = false;
      entity._embed_input = null;
    }
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
