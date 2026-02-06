/**
 * @file embedding-pipeline.ts
 * @description Batch embedding processor with halt/resume capability
 */

import type { EmbeddingEntity } from '../types/entities';
import type { EmbedModelAdapter, EmbedResult } from '../types/models';

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

  /** Maximum retries for failed embeddings (default 3) */
  max_retries?: number;

  /** Callback for progress updates */
  on_progress?: (current: number, total: number) => void;

  /** Callback for batch complete */
  on_batch_complete?: (batch_num: number, batch_size: number) => void;

  /** Callback to save after N batches (default: every 50 batches) */
  on_save?: () => Promise<void>;

  /** Save interval in batches (default 50) */
  save_interval?: number;

  /** Whether to halt on error (default false) */
  halt_on_error?: boolean;
}

/**
 * Embedding pipeline for batch processing entities
 * Handles queuing, batching, retries, and progress tracking
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
   * @param entities Array of entities that may need embedding
   * @param opts Pipeline options
   * @returns Statistics about the embedding process
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
      on_progress,
      on_batch_complete,
      on_save,
      save_interval = 50,
      halt_on_error = false,
    } = opts;

    const start_time = Date.now();

    try {
      // Filter entities that need embedding (don't require _embed_input yet — we prepare it per batch)
      const to_embed = entities.filter(e => e._queue_embed);
      this.stats.total = to_embed.length;

      if (to_embed.length === 0) {
        this.stats.duration_ms = Date.now() - start_time;
        return this.stats;
      }

      // Process in batches
      let batches_since_save = 0;
      for (let i = 0; i < to_embed.length; i += batch_size) {
        if (this.should_halt) {
          this.stats.skipped += to_embed.length - i;
          break;
        }

        const batch = to_embed.slice(i, i + batch_size);
        const batch_num = Math.floor(i / batch_size) + 1;

        // Prepare embed inputs for this batch (lazy — reads file content on demand)
        await Promise.all(batch.map(e => e.get_embed_input()));

        // Filter out entities that failed to get embed input
        const ready = batch.filter(e => e._embed_input && e._embed_input.length > 0);

        if (ready.length === 0) {
          this.stats.skipped += batch.length;
          continue;
        }

        try {
          await this.process_batch(ready, max_retries);
          this.stats.success += ready.length;
          this.stats.skipped += batch.length - ready.length;

          if (on_batch_complete) {
            on_batch_complete(batch_num, ready.length);
          }
        } catch (error) {
          this.stats.failed += batch.length;

          if (halt_on_error) {
            throw error;
          }
        }

        if (on_progress) {
          on_progress(Math.min(i + batch_size, to_embed.length), to_embed.length);
        }

        // Periodic save
        batches_since_save++;
        if (on_save && batches_since_save >= save_interval) {
          await on_save();
          batches_since_save = 0;
        }
      }

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
   * Process a single batch of entities
   * @param batch Batch of entities to embed
   * @param max_retries Maximum retry attempts
   */
  private async process_batch(batch: EmbeddingEntity[], max_retries: number): Promise<void> {
    let retries = 0;
    let last_error: Error | null = null;

    while (retries <= max_retries) {
      try {
        // Prepare inputs (entities already have _embed_input set)
        const inputs = batch.map(e => ({ _embed_input: e._embed_input! }));

        // Get embeddings from model
        const embeddings: EmbedResult[] = await this.model.embed_batch(inputs);

        // Assign embeddings to entities
        embeddings.forEach((emb, i) => {
          const entity = batch[i];
          entity.vec = emb.vec;

          // Update entity data
          if (!entity.data.embeddings) {
            entity.data.embeddings = {};
          }
          entity.data.embeddings[this.model.model_key] = {
            vec: emb.vec,
            tokens: emb.tokens,
          };

          // Mark as embedded
          entity._queue_embed = false;

          // Update last_embed to match last_read (if available)
          if (entity.data.last_read) {
            entity.data.last_embed = { ...entity.data.last_read };
          }
        });

        // Success - break retry loop
        return;
      } catch (error) {
        last_error = error as Error;
        retries++;

        if (retries <= max_retries) {
          // Wait before retry (exponential backoff)
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, retries) * 1000));
        }
      }
    }

    // All retries failed
    throw new Error(`Failed to embed batch after ${max_retries} retries: ${last_error?.message}`);
  }

  /**
   * Halt the current processing
   * The pipeline will stop after completing the current batch
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

  /**
   * Reset statistics
   */
  private reset_stats(): void {
    this.stats = {
      total: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      duration_ms: 0,
    };
  }
}
