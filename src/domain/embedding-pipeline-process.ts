import type { EmbeddingEntity } from '../types/entities';
import {
  build_batches,
  type EmbedPipelineOptions,
  type EmbedPipelineRuntime,
  type EmbedQueueStats,
} from './embedding-pipeline-types';
import {
  clear_queue_flags,
  to_progress_snapshot,
  wrap_batch_error,
} from './embedding-pipeline-results';
import {
  filter_by_hash,
  process_batch,
} from './embedding-pipeline-batch';

interface WorkerCounts {
  success: number;
  failed: number;
  skipped: number;
  batches: number;
}

export async function execute_embedding_process(
  runtime: EmbedPipelineRuntime,
  entities: EmbeddingEntity[],
  opts: EmbedPipelineOptions,
): Promise<EmbedQueueStats> {
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
  const to_embed = entities.filter((entity) => entity._queue_embed);
  runtime.stats.total = to_embed.length;
  if (to_embed.length === 0) {
    runtime.stats.duration_ms = Date.now() - start_time;
    return runtime.stats;
  }

  const batches = build_batches(to_embed, batch_size);
  let batches_since_save = 0;
  let entities_processed = 0;
  let save_chain: Promise<void> = Promise.resolve();
  const fatal_state: { error: Error | null } = { error: null };
  const pending_eviction: EmbeddingEntity[] = [];
  const effective_concurrency = Math.max(1, concurrency);
  let batch_index = 0;

  const mark_fatal = (error: unknown): void => {
    if (!fatal_state.error) {
      fatal_state.error = error instanceof Error ? error : new Error(String(error));
    }
    runtime.request_halt();
  };

  const flush_save = async (): Promise<void> => {
    if (!on_save) return;
    const run = save_chain.then(() => on_save());
    save_chain = run.catch(() => undefined);
    await run;
    const to_evict = pending_eviction.splice(0);
    for (const entity of to_evict) {
      entity.evictVec?.();
    }
  };

  const claim_remaining = (): number => {
    if (batch_index >= batches.length) return 0;
    let skipped = 0;
    for (let i = batch_index; i < batches.length; i++) {
      skipped += batches[i]?.length ?? 0;
    }
    batch_index = batches.length;
    return skipped;
  };

  const process_next_batch = async (): Promise<WorkerCounts> => {
    const local: WorkerCounts = { success: 0, failed: 0, skipped: 0, batches: 0 };

    while (batch_index < batches.length) {
      if (fatal_state.error || runtime.should_halt()) {
        local.skipped += claim_remaining();
        return local;
      }

      const batch = batches[batch_index++];
      if (!batch) continue;
      await Promise.all(batch.map((entity) => entity.get_embed_input()));

      const { passed: hash_filtered, skipped_count: hash_skipped } = filter_by_hash(batch, expected_hashes);
      local.skipped += hash_skipped;
      const ready = hash_filtered.filter((entity) => entity._embed_input && entity._embed_input.length > 0);
      const skipped_in_batch = hash_filtered.filter((entity) => !ready.includes(entity));

      if (ready.length === 0) {
        local.skipped += skipped_in_batch.length;
        clear_queue_flags(skipped_in_batch);
        entities_processed += batch.length;
        on_progress?.(entities_processed, to_embed.length, to_progress_snapshot(batch[batch.length - 1]));
        continue;
      }

      try {
        const { succeeded, failed_count } = await process_batch(
          runtime.model,
          ready,
          max_retries,
          pending_eviction,
        );
        local.success += succeeded;
        local.failed += failed_count;
        local.skipped += skipped_in_batch.length;
        clear_queue_flags(skipped_in_batch);
      } catch (error) {
        local.failed += batch.length;
        const batch_error = wrap_batch_error(
          error,
          batch,
          max_retries,
          runtime.model.adapter,
          runtime.model.model_key,
        );
        console.error(`[SC][Embed] ${batch_error.message}`);
        mark_fatal(batch_error);
        continue;
      }

      entities_processed += batch.length;
      on_progress?.(entities_processed, to_embed.length, to_progress_snapshot(ready[ready.length - 1]));
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

  const worker_results = await Promise.all(
    Array.from({ length: effective_concurrency }, () => process_next_batch()),
  );
  for (const result of worker_results) {
    runtime.stats.success += result.success;
    runtime.stats.failed += result.failed;
    runtime.stats.skipped += result.skipped;
  }

  if (on_save && batches_since_save > 0) {
    try {
      await flush_save();
    } catch (error) {
      mark_fatal(error);
    }
  }
  if (on_save) {
    await save_chain;
  }

  const fatal_message = fatal_state.error ? fatal_state.error.message : undefined;
  runtime.stats.outcome = fatal_state.error
    ? 'failed'
    : runtime.should_halt()
      ? 'halted'
      : 'completed';
  runtime.stats.error = fatal_message;
  runtime.stats.duration_ms = Date.now() - start_time;
  return runtime.stats;
}
