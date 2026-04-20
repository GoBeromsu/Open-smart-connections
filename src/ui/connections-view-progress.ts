import { invalidateConnectionsCache } from './block-connections';
import type { ConnectionsView } from './ConnectionsView';
import { clearAutoEmbedTimeout } from './connections-view-auto-embed';

export function cancelPendingRetry(view: ConnectionsView): void {
  if (view._pendingRetry === null) return;
  window.clearTimeout(view._pendingRetry);
  view._pendingRetry = null;
}

export function clearEmbedProgress(view: ConnectionsView): void {
  if (!view.embedProgress) return;
  view.embedProgress.destroy();
  view.embedProgress = null;
}

function clearConnectionsBanner(view: ConnectionsView): void {
  if (!view.container) return;
  view.container.querySelectorAll('.osc-banner').forEach((banner) => banner.remove());
}

export function addConnectionsBanner(view: ConnectionsView, message: string): void {
  clearConnectionsBanner(view);
  const banner = view.container.createDiv({ cls: 'osc-banner' });
  banner.createSpan({ text: message, cls: 'osc-banner-text' });
}

export function handleConnectionsModelSwitched(view: ConnectionsView): void {
  clearAutoEmbedTimeout(view);
  clearEmbedProgress(view);
  clearConnectionsBanner(view);
  invalidateConnectionsCache();
  view.resultsCache.invalidateAll();
  view.container.empty();
  addConnectionsBanner(view, 'Embedding model changed. Re-embedding in progress.');
  view.lastRenderedPath = null;
  view.lastRenderFingerprint = null;
  view.lastSearchFingerprint = null;
  view._lastResultKeys = [];
  view.autoEmbedRequestedForPath = null;
}

export function updateConnectionsProgressBanner(view: ConnectionsView): void {
  if (!view.container) return;

  const totalBlocks = view.plugin.block_collection?.effectiveTotal ?? 0;
  const embeddedBlocks = view.plugin.block_collection?.embeddedCount ?? 0;
  const isComplete = totalBlocks > 0 && embeddedBlocks >= totalBlocks;
  const runtime = view.plugin.getEmbedRuntimeState?.() ?? null;
  const hasPendingWork = totalBlocks > 0 && !isComplete;
  const modelLoading = runtime
    ? runtime.serving.kind === 'loading'
    : !view.plugin.embed_ready && view.plugin.status_state !== 'error';
  const isRunning = runtime
    ? runtime.backfill.kind === 'running'
    : view.plugin.status_state === 'embedding';

  let message: string | null = null;
  if (view.plugin.status_state === 'error') {
    message = hasPendingWork
      ? 'Embedding hit an error. Detailed diagnostics are in Settings; results may be stale.'
      : 'Embedding hit an error. See Settings for detailed diagnostics.';
  } else if (modelLoading) {
    message = 'Preparing embeddings. Detailed progress is in Settings.';
  } else if (isRunning) {
    message = 'Index updating. Detailed progress is in Settings; results may be stale.';
  } else if (hasPendingWork) {
    message = 'Index update pending. Detailed progress is in Settings; results may be stale.';
  }

  clearEmbedProgress(view);
  if (!message) {
    clearConnectionsBanner(view);
    return;
  }

  addConnectionsBanner(view, message);
}
