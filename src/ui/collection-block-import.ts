/**
 * @file collection-block-import.ts
 * @description Chunked background block import for sources discovered without block parsing.
 *              Yields after each file to keep the UI responsive.
 */

import type SmartConnectionsPlugin from '../main';

const SAVE_INTERVAL = 50;
const YIELD_MS = 10;

/**
 * Import blocks for sources that have no blocks yet.
 * Processes one file at a time with yields to keep the UI responsive.
 */
export async function importBlocksChunked(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!plugin.source_collection || !plugin.block_collection) return;

  const sources = plugin.source_collection.all.filter(
    (source) => plugin.block_collection!.for_source(source.key).length === 0,
  );

  if (sources.length === 0) return;

  const total = sources.length;
  plugin.logger.debug(`[SC] Block import: starting ${total} sources`);

  let processed = 0;
  for (const source of sources) {
    if (plugin._unloading) return;

    try {
      await plugin.block_collection.import_source_blocks(source);
    } catch (error) {
      plugin.logger.warn(`[SC] Block import failed for ${source.key}:`, error as Record<string, unknown>);
    }

    processed++;

    if (processed % SAVE_INTERVAL === 0) {
      await plugin.block_collection.data_adapter.save();
      plugin.logger.debug(`[SC] Block import: ${processed}/${total}`);
    }

    await new Promise((resolve) => setTimeout(resolve, YIELD_MS));
  }

  await plugin.block_collection.data_adapter.save();
  plugin.logger.debug(`[SC] Block import complete: ${total} sources`);
}
