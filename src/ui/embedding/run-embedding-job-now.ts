import type SmartConnectionsPlugin from '../../main';
import { resolveEmbeddingRunPolicy } from '../../domain/embed-provider-policy';
import type { EmbedQueueStats } from '../../domain/embedding-pipeline';
import type { EmbeddingEntity } from '../../types/entities';
import { errorMessage } from '../../utils';
import { saveCollections } from './collection-persistence';
import { updateEmbedNotice, showEmbeddingFailureNotice } from './embed-notices';
import { emitEmbedProgress } from './embed-progress-events';
import { createRunContext, finalizeFailedStats, finishRun, startRun } from './run-embedding-job-context';
import { publishEmbedContext } from './model-info';
import { scheduleFollowupRun } from './run-embedding-job';

function updateRunProgress(
  plugin: SmartConnectionsPlugin,
  runId: number,
  current: number,
  total: number,
  progress?: { current_key?: string | null; current_source_path?: string | null },
): void {
  const context = plugin.current_embed_context;
  if (!context || context.runId !== runId) return;

  context.current = current;
  context.total = total;
  if (progress?.current_key) context.currentEntityKey = progress.current_key;
  if (progress?.current_source_path) context.currentSourcePath = progress.current_source_path;
  context.phase = 'running';
  context.outcome = undefined;
  publishEmbedContext(plugin, context);
}

export async function runEmbeddingJobNow(
  plugin: SmartConnectionsPlugin,
  reason: string = 'Embedding run',
): Promise<EmbedQueueStats | null> {
  if (plugin.status_state === 'error' || plugin._unloading || !plugin.source_collection || !plugin.embedding_pipeline) {
    return null;
  }
  if (plugin.embedding_pipeline.is_active()) {
    plugin.logEmbed('run-skip-active', { reason });
    return null;
  }

  const entitiesToEmbed = (plugin.block_collection?.all || []).filter(
    (entity: EmbeddingEntity) => entity._queue_embed && entity.should_embed,
  );
  if (entitiesToEmbed.length === 0) {
    plugin.logEmbed('run-skip-empty', { reason });
    return null;
  }

  const context = createRunContext(plugin, reason, entitiesToEmbed);
  startRun(plugin, context);
  let unresolvedAfterRun = 0;
  let lastProgressEmit = 0;

  try {
    const { saveInterval: effectiveSaveInterval, concurrency: effectiveConcurrency } = resolveEmbeddingRunPolicy({
      adapter: context.adapter,
      dims: context.dims ?? 384,
      configuredSaveInterval: plugin.settings.embed_save_interval,
      configuredConcurrency: plugin.settings.embed_concurrency,
    });

    const stats = await plugin.embedding_pipeline.process(entitiesToEmbed, {
      batch_size: 10,
      max_retries: 3,
      concurrency: effectiveConcurrency,
      on_progress: (current, total, progress) => {
        updateRunProgress(plugin, context.runId, current, total, progress);
        if (Date.now() - lastProgressEmit > 1000 && plugin.current_embed_context?.runId === context.runId) {
          lastProgressEmit = Date.now();
          plugin.refreshStatus();
          emitEmbedProgress(plugin, plugin.current_embed_context);
          updateEmbedNotice(plugin, plugin.current_embed_context);
        }
      },
      on_save: async () => {
        await saveCollections(plugin);
        plugin.block_collection?.recomputeEmbeddedCount();
        plugin.source_collection?.recomputeEmbeddedCount();
        if (plugin.current_embed_context?.runId === context.runId) {
          plugin.current_embed_context.saveCount += 1;
          publishEmbedContext(plugin, plugin.current_embed_context);
        }
      },
      save_interval: effectiveSaveInterval,
    });

    if (plugin.current_embed_context?.runId !== context.runId) {
      plugin.setEmbedPhase('idle');
      plugin.current_embed_context = null;
      return stats;
    }

    if (stats.outcome === 'failed') {
      finalizeFailedStats(plugin, context, stats);
      return stats;
    }

    context.current = stats.success + stats.failed + stats.skipped;
    context.total = stats.total;
    context.outcome = stats.outcome;
    context.error = stats.error ?? null;

    if (stats.outcome === 'completed') {
      await saveCollections(plugin);
      plugin.block_collection?.recomputeEmbeddedCount();
      plugin.source_collection?.recomputeEmbeddedCount();
      context.saveCount += 1;
    }

    unresolvedAfterRun = plugin.queueUnembeddedEntities();
    context.followupQueued = unresolvedAfterRun > 0 && stats.outcome === 'completed' && !plugin._unloading;
    context.phase = stats.outcome === 'halted'
      ? 'halted'
      : context.followupQueued
        ? 'followup-required'
        : 'completed';

    publishEmbedContext(plugin, context);
    plugin.setEmbedPhase('idle');
    if (!context.followupQueued) {
      plugin.current_embed_context = null;
    }

    if (stats.outcome === 'completed' && !context.followupQueued) {
      plugin.notices.show('embedding_complete', { success: stats.success });
    }
    if (unresolvedAfterRun > 0) {
      plugin.logEmbed('run-stale-remaining', {
        runId: context.runId,
        adapter: context.adapter,
        modelKey: context.modelKey,
        current: unresolvedAfterRun,
        total: unresolvedAfterRun,
      });
    }
    if (context.followupQueued) {
      scheduleFollowupRun(plugin, `${reason} (follow-up)`, context.runId);
    }

    plugin.logEmbed('run-finished', {
      runId: context.runId,
      current: context.current,
      total: context.total,
      adapter: context.adapter,
      modelKey: context.modelKey,
      dims: context.dims,
      currentSourcePath: context.currentSourcePath,
    });
    return stats;
  } catch (error) {
    if (plugin.current_embed_context?.runId !== context.runId) {
      plugin.setEmbedPhase('idle');
      plugin.current_embed_context = null;
      throw error;
    }

    context.phase = 'failed';
    context.outcome = 'failed';
    context.error = errorMessage(error);
    publishEmbedContext(plugin, context);
    plugin.setEmbedPhase('error', { error: context.error });
    plugin.logEmbed('run-failed', {
      runId: context.runId,
      adapter: context.adapter,
      modelKey: context.modelKey,
      dims: context.dims,
      current: context.current,
      total: context.total,
      currentSourcePath: context.currentSourcePath,
      error: context.error,
    });
    showEmbeddingFailureNotice(plugin, context, context.error);
    throw error;
  } finally {
    finishRun(plugin, context);
  }
}
