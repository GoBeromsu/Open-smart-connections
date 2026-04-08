import type SmartConnectionsPlugin from '../main';

export async function saveCollections(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!plugin.source_collection) return;
  await plugin.source_collection.data_adapter.save();
  if (plugin.block_collection) {
    await plugin.block_collection.data_adapter.save();
  }
}
