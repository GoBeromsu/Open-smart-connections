import type { EmbeddingBlock } from '../domain/entities/EmbeddingBlock';
import type { ConnectionsView } from './ConnectionsView';

export function enqueueBlocksForEmbedding(blocks: EmbeddingBlock[]): void {
  for (const block of blocks) {
    block.queue_embed();
  }
}

export function clearAutoEmbedTimeout(view: ConnectionsView): void {
  if (view._autoEmbedTimeout === null) return;
  window.clearTimeout(view._autoEmbedTimeout);
  view._autoEmbedTimeout = null;
}

export function autoQueueBlockEmbedding(view: ConnectionsView, blocks: EmbeddingBlock[]): void {
  if (!view.plugin.embed_ready) return;
  const firstKey = blocks[0]?.key;
  if (!firstKey) return;

  const sourcePath = firstKey.split('#')[0] ?? '';
  if (view.autoEmbedRequestedForPath === sourcePath) return;
  view.autoEmbedRequestedForPath = sourcePath;
  clearAutoEmbedTimeout(view);

  try {
    enqueueBlocksForEmbedding(blocks);
    void view.plugin.runEmbeddingJob('Auto embed blocks for connections view');
  } catch {
    return;
  }

  view._autoEmbedTimeout = window.setTimeout(() => {
    view._autoEmbedTimeout = null;
    if (view.autoEmbedRequestedForPath === sourcePath) {
      view.autoEmbedRequestedForPath = null;
      void view.renderView(view.lastRenderedPath ?? undefined);
    }
  }, 10000);
}
