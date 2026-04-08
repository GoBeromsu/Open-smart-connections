import type SmartConnectionsPlugin from '../../main';
import type { EmbedQueueStats } from '../../domain/embedding-pipeline';
import type { EmbeddingEntity } from '../../types/entities';
import type { EmbeddingRunContext } from '../../types/embed-runtime';
import { clearEmbedNotice, showEmbeddingFailureNotice, updateEmbedNotice } from '../embed-notices';
import { emitEmbedProgress } from '../embed-progress-events';
import { getCurrentModelInfo, publishEmbedContext } from '../embed-model-info';

export function createRunContext(
  plugin: SmartConnectionsPlugin,
  reason: string,
  entitiesToEmbed: EmbeddingEntity[],
): EmbeddingRunContext {
  const model = getCurrentModelInfo(plugin);
  const firstEntity = entitiesToEmbed[0];

  return {
    runId: ++plugin.embed_run_seq,
    phase: 'running',
    reason,
    adapter: model.adapter,
    modelKey: model.modelKey,
    dims: model.dims,
    currentEntityKey: firstEntity?.key ?? null,
    currentSourcePath: firstEntity?.key?.split('#')[0] ?? null,
    startedAt: Date.now(),
    current: 0,
    total: entitiesToEmbed.length,
    blockTotal: entitiesToEmbed.length,
    saveCount: 0,
    sourceDataDir: plugin.source_collection?.data_dir ?? '',
    blockDataDir: plugin.block_collection?.data_dir ?? '',
    followupQueued: false,
    error: null,
  };
}

export function startRun(plugin: SmartConnectionsPlugin, context: EmbeddingRunContext): void {
  publishEmbedContext(plugin, context);
  plugin.setEmbedPhase('running');
  updateEmbedNotice(plugin, context, true);
  emitEmbedProgress(plugin, context);
  plugin.logEmbed('run-start', {
    runId: context.runId,
    reason: context.reason,
    adapter: context.adapter,
    modelKey: context.modelKey,
    dims: context.dims,
    current: 0,
    total: context.total,
    blockTotal: context.blockTotal,
    sourceDataDir: context.sourceDataDir,
    blockDataDir: context.blockDataDir,
  });
}

export function finalizeFailedStats(
  plugin: SmartConnectionsPlugin,
  context: EmbeddingRunContext,
  stats: EmbedQueueStats,
): void {
  context.current = stats.success + stats.failed + stats.skipped;
  context.total = stats.total;
  context.outcome = stats.outcome;
  context.error = stats.error ?? null;
  context.phase = 'failed';
  publishEmbedContext(plugin, context);
  plugin.setEmbedPhase('error', { error: stats.error ?? 'Embedding pipeline failed' });
  plugin.logEmbed('run-failed', {
    runId: context.runId,
    adapter: context.adapter,
    modelKey: context.modelKey,
    dims: context.dims,
    current: context.current,
    total: context.total,
    currentSourcePath: context.currentSourcePath,
    error: stats.error ?? 'Embedding pipeline failed',
  });
  showEmbeddingFailureNotice(plugin, context, stats.error);
}

export function finishRun(plugin: SmartConnectionsPlugin, context: EmbeddingRunContext): void {
  emitEmbedProgress(plugin, context, { done: true });
  publishEmbedContext(plugin, context);
  clearEmbedNotice(plugin);
}
