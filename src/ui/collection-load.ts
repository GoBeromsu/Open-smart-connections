import { TFile } from 'obsidian';
import type SmartConnectionsPlugin from '../main';
import { processInChunks } from '../utils';

const CHUNK_SIZE = 100;

const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => queueMicrotask(resolve));

export async function loadCollections(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    if (!plugin.source_collection || !plugin.block_collection) {
      throw new Error('Collections must be initialized before loading');
    }

    plugin.source_collection.data_adapter.load();
    plugin.block_collection.data_adapter.load();
    plugin.source_collection.loaded = true;
    plugin.block_collection.loaded = true;

    await processInChunks(
      plugin.source_collection.all,
      CHUNK_SIZE,
      (chunk) => {
        for (const source of chunk) {
          source.vault = plugin.source_collection!.vault;
          const file = plugin.app.vault.getAbstractFileByPath(source.key);
          if (file instanceof TFile) source.file = file;
        }
        return [];
      },
      yieldToEventLoop,
    );

    plugin.source_collection.recomputeEmbeddedCount();
    plugin.block_collection.recomputeEmbeddedCount();
    plugin.source_collection._initializing = false;

    const modelKey = plugin.source_collection.embed_model_key;
    plugin.logger.debug(
      `[SC][Init]   [collections] Loaded: ${plugin.source_collection.size} sources (${plugin.source_collection.embeddedCount} embedded), ` +
      `${plugin.block_collection.size} blocks (${plugin.block_collection.embeddedCount} embedded) [model_key=${modelKey}]`,
    );
  } catch (error) {
    plugin.logger.error('[SC][Init]   [collections] Failed to load collections:', error);
    plugin.notices.show('failed_load_collection_data');
    throw error;
  }
}

export async function detectStaleSourcesOnStartup(plugin: SmartConnectionsPlugin): Promise<number> {
  if (!plugin.source_collection) return 0;

  let staleCount = 0;
  await processInChunks(
    plugin.source_collection.all,
    CHUNK_SIZE,
    (chunk) => {
      for (const source of chunk) {
        const lastRead = source.data.last_read;
        if (!lastRead) continue;
        const file = source.file ?? plugin.app.vault.getAbstractFileByPath(source.key);
        if (!(file instanceof TFile)) continue;
        source.file = file;
        const mtimeMismatch = lastRead.mtime != null && file.stat.mtime !== lastRead.mtime;
        const sizeMismatch = lastRead.size != null && file.stat.size !== lastRead.size;
        if (mtimeMismatch || sizeMismatch) {
          plugin.pendingReImportPaths.add(source.key);
          staleCount++;
        }
      }
      return [];
    },
    yieldToEventLoop,
  );

  if (staleCount > 0) {
    plugin.logger.debug(`[SC] Startup: ${staleCount} stale sources detected (mtime/size mismatch)`);
  }
  return staleCount;
}
