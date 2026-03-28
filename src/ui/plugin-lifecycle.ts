import type SmartConnectionsPlugin from '../main';
import type { EmbedStatePhase } from '../types/embed-runtime';

export function beginLifecycle(plugin: SmartConnectionsPlugin): number {
  plugin._lifecycle_epoch += 1;
  return plugin._lifecycle_epoch;
}

export function isCurrentLifecycle(plugin: SmartConnectionsPlugin, epoch: number): boolean {
  return !plugin._unloading && plugin._lifecycle_epoch === epoch;
}

export function resetTransientRuntimeState(plugin: SmartConnectionsPlugin): void {
  plugin.ready = false;
  plugin.current_embed_context = null;
  plugin.embed_notice_last_update = 0;
  plugin.embed_notice_last_percent = 0;
  plugin.init_errors = [];
  plugin.pendingReImportPaths.clear();
  plugin._embed_state = {
    phase: 'idle',
    modelFingerprint: null,
    lastError: null,
  };
  plugin.embedding_job_queue?.clear('Plugin reset');
  plugin.embedding_job_queue = undefined;
  plugin.embedding_pipeline?.halt();
  plugin.embedding_pipeline = undefined;
  plugin.embed_adapter = undefined;
  plugin._search_embed_model = undefined;
  plugin.source_collection = undefined;
  plugin.block_collection = undefined;
  plugin._notices = undefined;
}

export function setEmbedPhase(
  plugin: SmartConnectionsPlugin,
  phase: EmbedStatePhase,
  opts: { error?: string; fingerprint?: string } = {},
): void {
  const previous = plugin._embed_state.phase;
  plugin._embed_state = {
    phase,
    modelFingerprint: opts.fingerprint ?? plugin._embed_state.modelFingerprint,
    lastError: phase === 'error' ? (opts.error ?? plugin._embed_state.lastError) : null,
  };

  if (previous !== phase) {
    plugin.logger.debug(`[Open Connections] ${previous} → ${phase}${opts.error ? `: ${opts.error}` : ''}`);
    plugin.app.workspace.trigger('open-connections:embed-state-changed', { phase, prev: previous });
    plugin.refreshStatus();
  }
}

export function resetEmbedError(plugin: SmartConnectionsPlugin): void {
  if (!plugin._embed_state.lastError) return;
  plugin._embed_state = { ...plugin._embed_state, lastError: null };
}
