import type SmartConnectionsPlugin from '../main';
import { getEmbedAdapterSettings } from '../utils/embed-settings';

export function syncCollectionEmbeddingContext(plugin: SmartConnectionsPlugin): void {
  const newModelKey = plugin.embed_adapter?.model_key;
  const modelDims = plugin.embed_adapter?.dims;

  if (plugin.source_collection) {
    if (newModelKey) {
      const oldKey = plugin.source_collection.embed_model_key;
      if (oldKey && oldKey !== 'None' && oldKey !== newModelKey) {
        plugin.logger.warn(`[SC][Init] [collections] WARNING: source model_key changed ${oldKey} → ${newModelKey}`);
      }
      plugin.source_collection.embed_model_key = newModelKey;
    }
    plugin.source_collection.embed_model_dims = modelDims;
    plugin.source_collection.data_adapter.rebuildVectorIndex();
  }

  if (plugin.block_collection) {
    if (newModelKey) {
      const oldKey = plugin.block_collection.embed_model_key;
      if (oldKey && oldKey !== 'None' && oldKey !== newModelKey) {
        plugin.logger.warn(`[SC][Init] [collections] WARNING: block model_key changed ${oldKey} → ${newModelKey}`);
      }
      plugin.block_collection.embed_model_key = newModelKey;
    }
    plugin.block_collection.embed_model_dims = modelDims;
    plugin.block_collection.data_adapter.rebuildVectorIndex();
  }
}

export function resolveStorageNamespace(plugin: SmartConnectionsPlugin, dataDir: string): string {
  const adapter = plugin.app.vault.adapter as unknown as { getBasePath?: () => string };
  const basePath = typeof adapter?.getBasePath === 'function'
    ? String(adapter.getBasePath())
    : '';
  const vaultName = plugin.app.vault.getName();
  return `${plugin.manifest.id}:${basePath || vaultName}:${dataDir.replace(/\/(sources|blocks)$/, '')}`;
}

export { getEmbedAdapterSettings };
