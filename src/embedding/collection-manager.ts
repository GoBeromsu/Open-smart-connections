/**
 * @file embedding/collection-manager.ts
 * @description Collection initialization, loading, and embedding context sync
 */

import type SmartConnectionsPlugin from '../main';
import { SourceCollection, BlockCollection } from '../../core/entities';
import type { EmbeddingKernelQueueSnapshot } from './kernel/types';

export async function initCollections(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    const dataDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/.smart-env`;
    const storageNamespace = resolveStorageNamespace(plugin, dataDir);

    const adapterSettings = getEmbedAdapterSettings(
      plugin.settings.smart_sources.embed_model as unknown as Record<string, any>,
    );
    const modelKey =
      plugin.embed_model?.model_key || adapterSettings.model_key || 'None';

    console.log(`Initializing collections with data dir: ${dataDir}`);

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

    let t = performance.now();
    await plugin.source_collection.data_adapter.load();
    plugin.source_collection.loaded = true;
    console.log(`[SC][Init]   [collections] Loading sources ✓ (${(performance.now() - t).toFixed(0)}ms)`);

    t = performance.now();
    await plugin.block_collection.data_adapter.load();
    plugin.block_collection.loaded = true;
    console.log(`[SC][Init]   [collections] Loading blocks ✓ (${(performance.now() - t).toFixed(0)}ms)`);
  } catch (error) {
    console.error('[SC][Init]   [collections] Failed to load collections:', error);
    plugin.notices.show('failed_load_collection_data');
    throw error;
  }
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

  if (plugin.source_collection) {
    for (const source of plugin.source_collection.all) {
      enqueueEntity(source);
    }
  }
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
  const adapter: any = plugin.app.vault.adapter as any;
  const basePath = typeof adapter?.getBasePath === 'function'
    ? String(adapter.getBasePath())
    : '';
  const vaultName = plugin.app.vault.getName();
  return `${plugin.manifest.id}:${basePath || vaultName}:${dataDir.replace(/\/(sources|blocks)$/, '')}`;
}
