import type { ConnectionResult } from '../types/entities';
import { autoQueueBlockEmbedding } from './connections-view-auto-embed';
import type { ConnectionsView } from './ConnectionsView';

export type ViewState =
  | { type: 'idle' }
  | { type: 'plugin_loading' }
  | { type: 'model_error' }
  | { type: 'embed_loading' }
  | { type: 'embed_degraded'; error?: string | null }
  | { type: 'pending_import'; path: string }
  | { type: 'note_too_short' }
  | { type: 'embedding_in_progress'; path: string }
  | { type: 'no_connections' }
  | { type: 'results'; path: string; results: ConnectionResult[] };

const EMBED_ERROR_MSG = 'Embedding model failed to initialize. Check Open Connections settings.';
const EMBED_DEGRADED_MSG = 'Embedding backlog hit an error. Existing indexed notes can still show connections. Check notices for details.';

export async function deriveConnectionsViewState(
  view: ConnectionsView,
  targetPath: string,
): Promise<ViewState> {
  const reader = view.reader;

  if (!reader.isReady()) {
    return { type: 'plugin_loading' };
  }

  if (reader.hasPendingReImport(targetPath)) {
    return { type: 'pending_import', path: targetPath };
  }

  const allFileBlocks = await reader.ensureBlocksForSource(targetPath);
  if (allFileBlocks.length === 0) return { type: 'note_too_short' };

  const embedded = allFileBlocks.filter((block) => block.has_embed());
  if (embedded.length > 0) {
    const results = await reader.getConnectionsForSource(targetPath, 50);
    return results.length === 0
      ? { type: 'no_connections' }
      : { type: 'results', path: targetPath, results: [...results] };
  }

  const runtime = reader.getEmbedRuntimeState();
  if (runtime) {
    switch (runtime.serving.kind) {
      case 'unavailable':
        return { type: 'model_error' };
      case 'degraded':
        return { type: 'embed_degraded', error: runtime.serving.error };
      case 'loading':
        return { type: 'embed_loading' };
      case 'ready':
        break;
    }
  }

  if (reader.getStatusState() === 'error') return { type: 'model_error' };
  if (!reader.isEmbedReady()) return { type: 'embed_loading' };

  autoQueueBlockEmbedding(view, allFileBlocks);
  return { type: 'embedding_in_progress', path: targetPath };
}

export function applyConnectionsViewState(view: ConnectionsView, state: ViewState): void {
  switch (state.type) {
    case 'idle':
      view.showEmpty('No active file');
      return;
    case 'plugin_loading':
      view.showLoading('Open Connections is initializing...');
      return;
    case 'model_error':
      view.showError(EMBED_ERROR_MSG);
      return;
    case 'embed_loading':
      view.showLoading('Open Connections is loading... Connections will appear when embedding is complete.');
      return;
    case 'embed_degraded':
      view.showError(state.error ? `${EMBED_DEGRADED_MSG}

Last error: ${state.error}` : EMBED_DEGRADED_MSG);
      return;
    case 'pending_import':
      view.showLoading('Importing note... Connections will appear when embedding is complete.');
      return;
    case 'note_too_short':
      view.showEmpty('Note is too short to find connections.');
      return;
    case 'embedding_in_progress':
      view.showLoading('Embedding this note... Results will appear when ready.');
      return;
    case 'no_connections':
      view.showEmpty('No related notes found.');
      return;
    case 'results':
      view.renderResults(state.path, state.results);
      return;
  }
}

export function scheduleConnectionsRetry(view: ConnectionsView, gen: number): boolean {
  if (gen === view._renderGen) return false;
  if (view._pendingRetry === null) {
    view._pendingRetry = window.setTimeout(() => {
      view._pendingRetry = null;
      void view.renderView();
    }, 150);
  }
  return true;
}
