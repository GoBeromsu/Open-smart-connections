import type SmartConnectionsPlugin from '../main';
import { isExcludedPath } from '../utils';

export async function processNewSourcesChunked(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!plugin.source_collection?.vault || !plugin.block_collection) return;

  const knownPaths = new Set(plugin.source_collection.all.map((source) => source.key));
  const folderExclusions = String(plugin.settings?.smart_sources?.folder_exclusions ?? '');
  const fileExclusions = String(plugin.settings?.smart_sources?.file_exclusions ?? '');
  const newFiles = plugin.app.vault.getMarkdownFiles().filter(
    (file) => !knownPaths.has(file.path) && !isExcludedPath(file.path, folderExclusions, fileExclusions),
  );

  if (newFiles.length === 0) return;

  const chunkSize = plugin.settings.discovery_chunk_size || 100;
  const total = newFiles.length;

  for (let index = 0; index < total; index += chunkSize) {
    if (plugin._unloading) return;
    const chunk = newFiles.slice(index, index + chunkSize);

    for (const file of chunk) {
      if (plugin._unloading) return;
      try {
        await plugin.source_collection.import_source(file);
      } catch (error) {
        plugin.logger.warn(`[SC] Failed to import ${file.path}:`, error as Record<string, unknown>);
      }
    }

    await plugin.source_collection.data_adapter.save();
    await plugin.block_collection.data_adapter.save();
    plugin.source_collection.recomputeEmbeddedCount();
    plugin.block_collection.recomputeEmbeddedCount();

    const queued = queueUnembeddedEntities(plugin);
    const processed = Math.min(index + chunkSize, total);
    if (queued > 0 && plugin.embedding_pipeline) {
      await plugin.runEmbeddingJob(`[chunked-pipeline] ${processed}/${total}`);
    }

    plugin.logger.debug(`[SC] Processed ${processed}/${total} files`);
    plugin.refreshStatus?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (!plugin._unloading) {
    const remaining = queueUnembeddedEntities(plugin);
    if (remaining > 0 && plugin.embedding_pipeline) {
      plugin.logger.debug(`[SC] Final sweep: ${remaining} remaining blocks to embed`);
      await plugin.runEmbeddingJob('[chunked-pipeline] final sweep');
    }
  }

  plugin.logger.debug(`[SC] All ${total} new files processed`);

  if (!plugin._unloading && plugin.pendingReImportPaths.size > 0) {
    const { debounceReImport } = await import('./file-watcher');
    plugin.logger.debug(`[SC] Post-chunked: ${plugin.pendingReImportPaths.size} source paths need re-import`);
    debounceReImport(plugin);
  }
}

export function queueUnembeddedEntities(plugin: SmartConnectionsPlugin): number {
  if (!plugin.block_collection) return 0;

  let queued = 0;
  for (const block of plugin.block_collection.all) {
    if (!block.is_unembedded) continue;
    block.queue_embed();
    if (!block._queue_embed) continue;
    queued++;
  }
  return queued;
}
