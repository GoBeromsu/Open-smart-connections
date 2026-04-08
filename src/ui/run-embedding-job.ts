import type SmartConnectionsPlugin from '../main';
import type { EmbedQueueStats } from '../domain/embedding-pipeline';
import { runEmbeddingJobNow } from './run-embedding-job-now';

export async function reembedStaleEntities(
  plugin: SmartConnectionsPlugin,
  reason: string = 'Manual re-embed',
): Promise<number> {
  return plugin.enqueueEmbeddingJob({
    type: 'REFRESH_REQUEST',
    key: 'REFRESH_REQUEST',
    priority: 20,
    run: async () => {
      plugin.resetError();
      plugin.setEmbedPhase('idle');
      const queued = plugin.queueUnembeddedEntities();
      if (queued === 0) {
        plugin.logEmbed('reembed-skip-empty', { reason });
        return 0;
      }
      await runEmbeddingJobNow(plugin, reason);
      return queued;
    },
  });
}

export async function runEmbeddingJob(
  plugin: SmartConnectionsPlugin,
  reason: string = 'Embedding run',
): Promise<EmbedQueueStats | null> {
  return plugin.enqueueEmbeddingJob({
    type: 'RUN_EMBED_BATCH',
    key: 'RUN_EMBED_BATCH',
    priority: 30,
    run: async () => runEmbeddingJobNow(plugin, reason),
  });
}

export function scheduleFollowupRun(plugin: SmartConnectionsPlugin, reason: string, runId: number): void {
  void plugin.enqueueEmbeddingJob({
    type: 'RUN_EMBED_FOLLOWUP',
    key: `RUN_EMBED_FOLLOWUP:${runId}`,
    priority: 31,
    run: async () => runEmbeddingJobNow(plugin, reason),
  }).catch((error) => {
    plugin.logger.warn('[SC] Failed to schedule embedding follow-up run', { error: String(error) });
  });
}
