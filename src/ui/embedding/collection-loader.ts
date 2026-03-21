/**
 * @file embedding/collection-loader.ts
 * @description Collection initialization, loading, and embedding context sync
 */

import type SmartConnectionsPlugin from '../../main';
import { SourceCollection, BlockCollection } from '../../domain/entities';
import type { EmbeddingKernelQueueSnapshot } from '../../domain/embedding/kernel/types';

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

export async function discoverNewSources(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!plugin.source_collection?.vault) return;
  const knownPaths = new Set(plugin.source_collection.all.map((s: any) => s.key));
  const vaultFiles = plugin.app.vault.getMarkdownFiles();
  const newFiles = vaultFiles.filter(f => !knownPaths.has(f.path));

  if (newFiles.length === 0) return;

  const CHUNK_SIZE = plugin.settings.discovery_chunk_size || 50;
  const total = newFiles.length;

  for (let i = 0; i < total; i += CHUNK_SIZE) {
    if (plugin._unloading) return;
    const chunk = newFiles.slice(i, i + CHUNK_SIZE);

    for (const file of chunk) {
      if (plugin._unloading) return;
      try {
        await plugin.source_collection.import_source(file);
      } catch (err) {
        console.warn(`[SC] Discovery: failed to import ${file.path}:`, err);
      }
    }

    // Save to in-memory DB (flushed to disk by autosave timer)
    await plugin.source_collection.data_adapter.save();
    if (plugin.block_collection) {
      await plugin.block_collection.data_adapter.save();
    }

    const processed = Math.min(i + CHUNK_SIZE, total);
    console.log(`[SC] Discovery: ${processed}/${total} files`);
    plugin.refreshStatus?.();

    // Yield to event loop
    await new Promise(r => setTimeout(r, 0));
  }

  console.log(`[SC] Discovery complete: ${total} new files`);
}

export function queueUnembeddedEntities(plugin: SmartConnectionsPlugin): number {
  let queued = 0;
  const now = Date.now();

  const enqueueEntity = (entity: any): void => {
    if (!entity.is_unembedded) return;
    // Set _queue_embed for pipeline compatibility
    entity.queue_embed();
    if (!entity._queue_embed) return;
    // Enqueue into the unified EmbedJobQueue (single source of truth)
    plugin.embed_job_queue?.enqueue({
      entityKey: entity.key,
      contentHash: entity.read_hash || '',
      sourcePath: String(entity.key || '').split('#')[0],
      enqueuedAt: now,
    });
    queued++;
  };

  // Source-level embedding is disabled — blocks only.
  // Sources return should_embed=false so skipping them avoids unnecessary iteration.
  if (plugin.block_collection) {
    for (const block of plugin.block_collection.all) {
      enqueueEntity(block);
    }
  }

  return queued;
}

export function getEmbeddingQueueSnapshot(plugin: SmartConnectionsPlugin): EmbeddingKernelQueueSnapshot {
  let staleTotal = 0;
  let staleEmbeddableTotal = 0;

  // Use EmbedJobQueue as the single source of truth for queued count
  const queuedTotal = plugin.embed_job_queue?.size() ?? 0;

  const accountEntity = (entity: any): void => {
    if (!entity) return;
    if (!entity.is_unembedded) return;
    staleTotal += 1;
    if (entity.should_embed) staleEmbeddableTotal += 1;
  };

  for (const source of plugin.source_collection?.all || []) {
    accountEntity(source);
  }
  for (const block of plugin.block_collection?.all || []) {
    accountEntity(block);
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
