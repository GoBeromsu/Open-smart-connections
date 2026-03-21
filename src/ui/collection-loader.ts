/**
 * @file collection-loader.ts
 * @description Collection initialization, loading, and embedding context sync
 */

import type SmartConnectionsPlugin from '../main';
import { SourceCollection, BlockCollection } from '../domain/entities';
import type { EmbeddingKernelQueueSnapshot } from '../domain/embedding/kernel/types';

export async function initCollections(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    const dataDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/.smart-env`;
    const storageNamespace = resolveStorageNamespace(plugin, dataDir);

    const adapterSettings = getEmbedAdapterSettings(
      plugin.settings.smart_sources.embed_model as unknown as Record<string, any>,
    );
    const modelKey =
      plugin.embed_model?.model_key || adapterSettings.model_key || 'None';

    console.log(`[SC][Init]   [collections] Initializing with model_key=${modelKey}, data_dir=${dataDir}`);

    plugin.source_collection = new SourceCollection(
      `${dataDir}/sources`,
      plugin.settings.smart_sources,
      modelKey,
      plugin.app.vault,
      plugin.app.metadataCache,
      storageNamespace,
    );

    plugin.block_collection = new BlockCollection(
      `${dataDir}/blocks`,
      plugin.settings.smart_blocks,
      modelKey,
      plugin.source_collection,
      storageNamespace,
    );

    plugin.source_collection.block_collection = plugin.block_collection;

    // Provide vault context to SQLite adapters for file I/O
    const vaultAdapter = plugin.app.vault.adapter;
    const configDir = plugin.app.vault.configDir;
    const pluginId = plugin.manifest.id;
    plugin.source_collection.data_adapter.initVaultContext(vaultAdapter, configDir, pluginId);
    plugin.block_collection.data_adapter.initVaultContext(vaultAdapter, configDir, pluginId);

    await plugin.source_collection.init();
    await plugin.block_collection.init();

    console.log('Collections initialized successfully');
  } catch (error) {
    console.error('Failed to initialize collections:', error);
    throw error;
  }
}

export async function loadCollections(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    if (!plugin.source_collection || !plugin.block_collection) {
      throw new Error('Collections must be initialized before loading');
    }

    const t = performance.now();
    await Promise.all([
      plugin.source_collection.data_adapter.load(),
      plugin.block_collection.data_adapter.load(),
    ]);
    plugin.source_collection.loaded = true;
    plugin.block_collection.loaded = true;
    console.log(`[SC][Init]   [collections] Loading sources + blocks ✓ (${(performance.now() - t).toFixed(0)}ms)`);

    plugin.source_collection._initializing = false;
  } catch (error) {
    console.error('[SC][Init]   [collections] Failed to load collections:', error);
    plugin.notices.show('failed_load_collection_data');
    throw error;
  }
}

/**
 * Unified chunked pipeline: discover + embed + save per chunk of new files.
 * Must be called AFTER the embedding model and pipeline are initialized.
 */
export async function processNewSourcesChunked(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!plugin.source_collection?.vault || !plugin.block_collection) return;

  const knownPaths = new Set(plugin.source_collection.all.map(s => s.key));
  const newFiles = plugin.app.vault.getMarkdownFiles().filter(f => !knownPaths.has(f.path));

  if (newFiles.length === 0) return;

  plugin._chunked_pipeline_active = true;
  const chunkSize = plugin.settings.discovery_chunk_size || 1000;
  const total = newFiles.length;

  try {
    for (let i = 0; i < total; i += chunkSize) {
      if (plugin._unloading) return;
      const chunk = newFiles.slice(i, i + chunkSize);

      for (const file of chunk) {
        if (plugin._unloading) return;
        try {
          await plugin.source_collection.import_source(file);
        } catch (err) {
          console.warn(`[SC] Failed to import ${file.path}:`, err);
        }
      }

      await plugin.source_collection.data_adapter.save();
      await plugin.block_collection.data_adapter.save();

      const chunkQueued = queueUnembeddedEntities(plugin);
      const processed = Math.min(i + chunkSize, total);

      if (chunkQueued > 0 && plugin.embedding_pipeline) {
        await plugin.runEmbeddingJobImmediate(`[chunked-pipeline] ${processed}/${total}`);
      }

      console.log(`[SC] Processed ${processed}/${total} files`);
      plugin.refreshStatus?.();
      await new Promise(r => setTimeout(r, 0));
    }

    if (!plugin._unloading) {
      const remaining = queueUnembeddedEntities(plugin);
      if (remaining > 0 && plugin.embedding_pipeline) {
        console.log(`[SC] Final sweep: ${remaining} remaining blocks to embed`);
        await plugin.runEmbeddingJobImmediate('[chunked-pipeline] final sweep');
      }
      // Preserve source-level re-import paths queued during chunked processing,
      // then clear only block-level embed jobs (which are done).
      const pendingReimports = plugin.embed_job_queue?.toArray().filter(j => !j.entityKey.includes('#')) ?? [];
      plugin.embed_job_queue?.clear();
      // Re-queue source paths so post-chunked re-import can process them
      for (const j of pendingReimports) {
        plugin.embed_job_queue?.enqueue(j);
      }
    }

    console.log(`[SC] All ${total} new files processed`);
  } finally {
    plugin._chunked_pipeline_active = false;
    // If source paths were queued during chunked processing, trigger re-import
    if (!plugin._unloading) {
      const { debounceReImport } = await import('./file-watcher');
      const pending = plugin.embed_job_queue?.toArray().filter(j => !j.entityKey.includes('#')) ?? [];
      if (pending.length > 0) {
        console.log(`[SC] Post-chunked: ${pending.length} source paths need re-import`);
        debounceReImport(plugin);
      }
    }
  }
}

export function queueUnembeddedEntities(plugin: SmartConnectionsPlugin): number {
  if (!plugin.block_collection) return 0;

  let queued = 0;
  const now = Date.now();

  for (const block of plugin.block_collection.all) {
    if (!block.is_unembedded) continue;
    block.queue_embed();
    if (!block._queue_embed) continue;

    plugin.embed_job_queue?.enqueue({
      entityKey: block.key,
      contentHash: block.read_hash || '',
      sourcePath: String(block.key || '').split('#')[0],
      enqueuedAt: now,
    });
    queued++;
  }

  return queued;
}

export function getEmbeddingQueueSnapshot(plugin: SmartConnectionsPlugin): EmbeddingKernelQueueSnapshot {
  let staleTotal = 0;
  let staleEmbeddableTotal = 0;

  const queuedTotal = plugin.embed_job_queue?.size() ?? 0;

  for (const source of plugin.source_collection?.all || []) {
    if (source?.is_unembedded) {
      staleTotal += 1;
      if (source.should_embed) staleEmbeddableTotal += 1;
    }
  }
  for (const block of plugin.block_collection?.all || []) {
    if (block?.is_unembedded) {
      staleTotal += 1;
      if (block.should_embed) staleEmbeddableTotal += 1;
    }
  }

  return {
    pendingJobs: plugin.embedding_job_queue?.size?.() ?? 0,
    staleTotal,
    staleEmbeddableTotal,
    queuedTotal,
  };
}

export function syncCollectionEmbeddingContext(plugin: SmartConnectionsPlugin): void {
  const modelKey = plugin.embed_model?.model_key;
  const modelDims = plugin.embed_model?.adapter?.dims;

  if (plugin.source_collection) {
    if (modelKey) plugin.source_collection.embed_model_key = modelKey;
    plugin.source_collection.embed_model_dims = modelDims;
  }

  if (plugin.block_collection) {
    if (modelKey) plugin.block_collection.embed_model_key = modelKey;
    plugin.block_collection.embed_model_dims = modelDims;
  }
}

export function getEmbedAdapterSettings(embedSettings?: Record<string, any>): Record<string, any> {
  if (!embedSettings) return {};
  const adapterType = embedSettings.adapter;
  if (typeof adapterType !== 'string' || adapterType.length === 0) return {};
  const settings = embedSettings[adapterType];
  return settings && typeof settings === 'object' ? settings : {};
}

function resolveStorageNamespace(plugin: SmartConnectionsPlugin, dataDir: string): string {
  const adapter = plugin.app.vault.adapter as any;
  const basePath = typeof adapter?.getBasePath === 'function'
    ? String(adapter.getBasePath())
    : '';
  const vaultName = plugin.app.vault.getName();
  return `${plugin.manifest.id}:${basePath || vaultName}:${dataDir.replace(/\/(sources|blocks)$/, '')}`;
}
