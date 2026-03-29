import type { EmbeddingEntity } from '../types/entities';
import type { EmbedResult } from '../types/models';
import type { EmbedProgressSnapshot } from './embedding-pipeline-types';
import { BatchIntegrityError } from './embedding-pipeline-types';

export function index_results(
  batch: EmbeddingEntity[],
  embeddings: EmbedResult[],
): Map<string, EmbedResult> {
  if (embeddings.length !== batch.length) {
    throw new BatchIntegrityError(
      `Embedding adapter returned ${embeddings.length} results for ${batch.length} inputs`,
    );
  }

  const expected_keys = new Set(batch.map((entity) => entity.key));
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

export function clear_queue_flags(entities: EmbeddingEntity[]): void {
  for (const entity of entities) {
    entity._queue_embed = false;
    entity._embed_input = null;
  }
}

export function create_retry_exhausted_error(
  last_error: Error | null,
  max_retries: number,
): Error {
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

export function wrap_batch_error(
  error: unknown,
  batch: EmbeddingEntity[],
  max_retries: number,
  adapter: string,
  model_key: string,
): Error {
  const exhausted = error instanceof Error
    ? error
    : create_retry_exhausted_error(new Error(String(error)), max_retries);
  const first_key = batch[0]?.key ?? 'unknown';
  const batch_error = new Error(
    `Embedding batch failed (${adapter}/${model_key}) after ${max_retries} retries ` +
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

export function to_progress_snapshot(entity?: EmbeddingEntity): EmbedProgressSnapshot {
  if (!entity) {
    return { current_key: null, current_source_path: null };
  }
  const current_key = entity.key ?? null;
  const current_source_path = current_key ? (current_key.split('#')[0] ?? null) : null;
  return { current_key, current_source_path };
}
