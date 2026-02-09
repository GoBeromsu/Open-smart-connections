/**
 * @file embedding/collection-manager.ts
 * @description Collection initialization, loading, and embedding context sync
 */

import type SmartConnectionsPlugin from '../main';
import { SourceCollection, BlockCollection } from '../../core/entities';
import type { EmbeddingKernelQueueSnapshot } from './kernel/types';

export interface EmbedModelFingerprint {
  adapter: string;
  modelKey: string;
  host: string;
  value: string;
}

export async function initCollections(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    const dataDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/.smart-env`;
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
    );

    plugin.block_collection = new BlockCollection(
      `${dataDir}/blocks`,
      plugin.settings.smart_blocks,
      modelKey,
      plugin.source_collection,
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

  if (plugin.source_collection) {
    for (const source of plugin.source_collection.all) {
      if (!source.is_unembedded) continue;
      const was_queued = source._queue_embed;
      source.queue_embed();
      if (!was_queued && source._queue_embed) queued++;
    }
  }

  if (plugin.block_collection) {
    for (const block of plugin.block_collection.all) {
      if (!block.is_unembedded) continue;
      const was_queued = block._queue_embed;
      block.queue_embed();
      if (!was_queued && block._queue_embed) queued++;
    }
  }

  return queued;
}

export function getEmbeddingQueueSnapshot(plugin: SmartConnectionsPlugin): EmbeddingKernelQueueSnapshot {
  let staleTotal = 0;
  let staleEmbeddableTotal = 0;
  let queuedTotal = 0;

  const accountEntity = (entity: any): void => {
    if (!entity) return;
    if (entity._queue_embed) queuedTotal += 1;
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

export function getTargetEmbeddingFingerprint(plugin: SmartConnectionsPlugin): EmbedModelFingerprint {
  const embedSettings = plugin.settings?.smart_sources?.embed_model as Record<string, any> | undefined;
  const adapter = normalizeFingerprintValue(embedSettings?.adapter);
  const adapterSettings = getEmbedAdapterSettings(embedSettings);
  const modelKey = normalizeFingerprintValue(adapterSettings?.model_key);
  const host = normalizeFingerprintValue(adapterSettings?.host);
  return {
    adapter,
    modelKey,
    host,
    value: `${adapter}|${modelKey}|${host}`,
  };
}

export function getActiveEmbeddingFingerprint(plugin: SmartConnectionsPlugin): EmbedModelFingerprint | null {
  if (!plugin.embed_model) return null;
  const adapter = normalizeFingerprintValue(
    (plugin.embed_model as any)?.adapter?.adapter
      || plugin.settings?.smart_sources?.embed_model?.adapter,
  );
  const modelKey = normalizeFingerprintValue(plugin.embed_model.model_key);
  const host = normalizeFingerprintValue((plugin.embed_model as any)?.adapter?.host);
  return {
    adapter,
    modelKey,
    host,
    value: `${adapter}|${modelKey}|${host}`,
  };
}

export function hasEmbeddingFingerprintChanged(
  previous: EmbedModelFingerprint | null,
  current: EmbedModelFingerprint | null,
): boolean {
  if (!previous || !current) return false;
  return previous.value !== current.value;
}

export function markAllEntitiesStaleForModelSwitch(
  plugin: SmartConnectionsPlugin,
  reason: string,
  fingerprint: EmbedModelFingerprint,
): number {
  const now = Date.now();
  const reasonKey = normalizeReason(reason);
  const dims = plugin.embed_model?.adapter?.dims;
  let marked = 0;

  const markEntity = (entity: any): void => {
    if (!entity || typeof entity.set_active_embedding_meta !== 'function') {
      return;
    }
    const readHash = typeof entity.read_hash === 'string' && entity.read_hash.length > 0
      ? entity.read_hash
      : 'no_read_hash';
    entity.set_active_embedding_meta({
      hash: `__forced_stale__${reasonKey}__${now}__${readHash}`,
      updated_at: now,
      adapter: fingerprint.adapter,
      dims,
    });
    entity.queue_embed?.();
    marked++;
  };

  for (const source of plugin.source_collection?.all || []) {
    markEntity(source);
  }
  for (const block of plugin.block_collection?.all || []) {
    markEntity(block);
  }

  return marked;
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

function normalizeFingerprintValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toLowerCase();
}

function normalizeReason(reason: string): string {
  const raw = String(reason || '').trim().toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'model_switch';
}
