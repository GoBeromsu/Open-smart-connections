import { invalidateConnectionsCache } from './block-connections';
import type { ConnectionsView } from './ConnectionsView';
import { renderEmbedProgress } from './embed-progress';
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

export function addConnectionsBanner(view: ConnectionsView, message: string): void {
  const banner = view.container.createDiv({ cls: 'osc-banner' });
  banner.createSpan({ text: message, cls: 'osc-banner-text' });
}

export function handleConnectionsModelSwitched(view: ConnectionsView): void {
  clearAutoEmbedTimeout(view);
  clearEmbedProgress(view);
  invalidateConnectionsCache();
  view.container.empty();
  addConnectionsBanner(view, 'Embedding model changed. Re-embedding in progress.');
  view.lastRenderedPath = null;
  view.lastRenderFingerprint = null;
  view._lastResultKeys = [];
  view.autoEmbedRequestedForPath = null;
}

export function updateConnectionsProgressBanner(view: ConnectionsView): void {
  if (!view.container) return;

  const totalBlocks = view.plugin.block_collection?.effectiveTotal ?? 0;
  const embeddedBlocks = view.plugin.block_collection?.embeddedCount ?? 0;
  const isComplete = totalBlocks > 0 && embeddedBlocks >= totalBlocks;
  const runtime = view.plugin.getEmbedRuntimeState?.() ?? null;

  const modelLoading = runtime
    ? runtime.serving.kind === 'loading'
    : !view.plugin.embed_ready && view.plugin.status_state !== 'error';
  const isRunning = runtime
    ? runtime.backfill.kind === 'running'
    : view.plugin.status_state === 'embedding';
  const shouldShow = runtime
    ? modelLoading || isRunning || (totalBlocks > 0 && !isComplete && runtime.serving.kind === 'ready')
    : modelLoading || view.plugin.status_state === 'embedding' || (totalBlocks > 0 && !isComplete);

  if (!shouldShow) {
    clearEmbedProgress(view);
    return;
  }

  if (!view.embedProgress) {
    view.embedProgress = renderEmbedProgress(view.container, view.plugin, { prepend: true });
  } else {
    view.embedProgress.update();
  }
}
