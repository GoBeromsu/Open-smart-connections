import type { EmbeddingEntity } from '../types/entities';
import type { EmbedModelAdapter, EmbedResult } from '../types/models';
import { create_hash } from '../utils';
import {
  clear_queue_flags,
  create_retry_exhausted_error,
  index_results,
} from './embedding-pipeline-results';

export function filter_by_hash(
  batch: EmbeddingEntity[],
  expected_hashes?: Record<string, string>,
): { passed: EmbeddingEntity[]; skipped_count: number } {
  if (!expected_hashes) return { passed: batch, skipped_count: 0 };

  let skipped_count = 0;
  const passed = batch.filter((entity) => {
    const expected = expected_hashes[entity.key];
    if (expected === undefined) return true;
    if (entity.data.last_read?.hash !== expected) {
      skipped_count++;
      clear_queue_flags([entity]);
      return false;
    }
    return true;
  });

  return { passed, skipped_count };
}

export function compute_backoff(retry_number: number, error: unknown): number {
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

export async function process_batch(
  model: EmbedModelAdapter,
  batch: EmbeddingEntity[],
  max_retries: number,
  pending_eviction: EmbeddingEntity[] = [],
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
      const embeddings: EmbedResult[] = await model.embed_batch(inputs);
      const embeddings_by_entity = index_results(batch, embeddings);

      let succeeded = 0;
      let failed_count = 0;
      const updated_at = Date.now();

      for (const entity of batch) {
        const embedding = embeddings_by_entity.get(entity.key);
        if (!embedding?.vec || embedding.vec.length === 0) {
          failed_count++;
          continue;
        }

        entity.vec = embedding.vec;
        entity.tokens = embedding.tokens;
        pending_eviction.push(entity);

        if (entity.data.last_read) {
          entity.data.last_embed = { ...entity.data.last_read };
          entity.set_active_embedding_meta({
            hash: entity.data.last_read.hash,
            size: entity.data.last_read.size,
            mtime: entity.data.last_read.mtime,
            dims: model.dims,
            adapter: model.adapter,
            updated_at,
          });
        } else if (entity._embed_input) {
          const synthetic_hash = await create_hash(entity._embed_input);
          entity.data.last_read = { hash: synthetic_hash };
          entity.data.last_embed = { hash: synthetic_hash };
          entity.set_active_embedding_meta({
            hash: synthetic_hash,
            dims: model.dims,
            adapter: model.adapter,
            updated_at,
          });
        }

        succeeded++;
      }

      if (succeeded === 0 && failed_count > 0) {
        throw new Error('Embedding adapter returned no usable vectors for this batch');
      }

      batch.forEach((entity) => {
        const embedding = embeddings_by_entity.get(entity.key);
        if (embedding?.vec && embedding.vec.length > 0) {
          entity._queue_embed = false;
          entity._embed_input = null;
        }
      });

      return { succeeded, failed_count };
    } catch (error) {
      if (error instanceof Error && (error.name === 'FatalError' || error.name === 'BatchIntegrityError')) {
        throw error;
      }

      last_error = error as Error;
      retries++;
      if (retries <= max_retries) {
        await new Promise((resolve) => setTimeout(resolve, compute_backoff(retries, error)));
      }
    }
  }

  throw create_retry_exhausted_error(last_error, max_retries);
}
