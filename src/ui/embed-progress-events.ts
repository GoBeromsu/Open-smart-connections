import type SmartConnectionsPlugin from '../main';
import type { EmbedProgressEventPayload, EmbeddingRunContext } from '../types/embed-runtime';

export function emitEmbedProgress(
  plugin: SmartConnectionsPlugin,
  context: EmbeddingRunContext,
  opts: { done?: boolean; error?: string } = {},
): void {
  const elapsedMs = Date.now() - context.startedAt;
  const percent = context.total > 0 ? Math.round((context.current / context.total) * 100) : 0;
  const payload: EmbedProgressEventPayload = {
    runId: context.runId,
    phase: context.phase,
    outcome: context.outcome,
    reason: context.reason,
    adapter: context.adapter,
    modelKey: context.modelKey,
    dims: context.dims,
    currentEntityKey: context.currentEntityKey,
    currentSourcePath: context.currentSourcePath,
    current: context.current,
    total: context.total,
    percent,
    blockTotal: context.blockTotal,
    saveCount: context.saveCount,
    sourceDataDir: context.sourceDataDir,
    blockDataDir: context.blockDataDir,
    startedAt: context.startedAt,
    elapsedMs,
    followupQueued: context.followupQueued,
    done: opts.done,
    error: opts.error ?? context.error ?? undefined,
  };

  plugin.app.workspace.trigger('open-connections:embed-progress', payload);
}
