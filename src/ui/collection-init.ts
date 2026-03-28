import type SmartConnectionsPlugin from '../main';
import { BlockCollection, SourceCollection } from '../domain/entities';
import type { VaultShim } from '../types/obsidian-shims';
import { getEmbedAdapterSettings, resolveStorageNamespace } from './collection-embed-context';

export async function initCollections(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    const dataDir = `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}/.smart-env`;
    const storageNamespace = resolveStorageNamespace(plugin, dataDir);
    const adapterSettings = getEmbedAdapterSettings(
      plugin.settings.smart_sources.embed_model as unknown as Record<string, unknown>,
    );
    const modelKey =
      plugin.embed_adapter?.model_key || (adapterSettings.model_key as string | undefined) || 'None';

    plugin.logger.debug(`[SC][Init]   [collections] Initializing with model_key=${modelKey}, data_dir=${dataDir}`);

    plugin.source_collection = new SourceCollection(
      `${dataDir}/sources`,
      plugin.settings.smart_sources,
      modelKey,
      plugin.app.vault as unknown as VaultShim,
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

    const vaultAdapter = plugin.app.vault.adapter;
    const configDir = plugin.app.vault.configDir;
    const pluginId = plugin.manifest.id;
    plugin.source_collection.data_adapter.initVaultContext(vaultAdapter, configDir, pluginId);
    plugin.block_collection.data_adapter.initVaultContext(vaultAdapter, configDir, pluginId);

    await plugin.source_collection.init();
    await plugin.block_collection.init();
    plugin.logger.debug('Collections initialized successfully');
  } catch (error) {
    plugin.logger.error('Failed to initialize collections:', error);
    throw error;
  }
}
