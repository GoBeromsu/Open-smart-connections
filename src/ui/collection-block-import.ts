/**
 * @file collection-block-import.ts
 * @description Chunked background block import for sources discovered without block parsing.
 *              Yields after each file to keep the UI responsive.
 */

import type SmartConnectionsPlugin from '../main';

const SAVE_INTERVAL = 50;
const YIELD_MS = 10;

export interface BlockImportResult {
  importedCount: number;
  remainingCount: number;
  totalCount: number;
}

/**
 * Import blocks for sources that have no blocks yet.
 * Processes one file at a time with yields to keep the UI responsive.
 */
export async function importBlocksChunked(
  plugin: SmartConnectionsPlugin,
  options: { limit?: number } = {},
): Promise<BlockImportResult> {
  if (!plugin.source_collection || !plugin.block_collection) {
    return { importedCount: 0, remainingCount: 0, totalCount: 0 };
  }

  const sources = plugin.source_collection.all.filter(
    (source) => plugin.block_collection!.for_source(source.key).length === 0,
  );

  if (sources.length === 0) {
    return { importedCount: 0, remainingCount: 0, totalCount: 0 };
  }

  const totalCount = sources.length;
  const limit = options.limit && options.limit > 0
    ? Math.min(options.limit, totalCount)
    : totalCount;
  const selectedSources = sources.slice(0, limit);
  plugin.logger.debug(
    `[SC] Block import: starting ${selectedSources.length}/${totalCount} sources`,
  );

  let importedCount = 0;
  for (const source of selectedSources) {
    if (plugin._unloading) {
      return {
        importedCount,
        remainingCount: Math.max(totalCount - importedCount, 0),
        totalCount,
      };
    }

    try {
      await plugin.block_collection.import_source_blocks(source);
    } catch (error) {
      plugin.logger.warn(`[SC] Block import failed for ${source.key}:`, error as Record<string, unknown>);
    }

    importedCount++;

    if (importedCount % SAVE_INTERVAL === 0) {
      await plugin.block_collection.data_adapter.save();
      plugin.logger.debug(`[SC] Block import: ${importedCount}/${totalCount}`);
    }

    await new Promise((resolve) => setTimeout(resolve, YIELD_MS));
  }

  await plugin.block_collection.data_adapter.save();
  plugin.logger.debug(
    `[SC] Block import complete: imported ${importedCount}/${totalCount} sources`,
  );

  return {
    importedCount,
    remainingCount: Math.max(totalCount - importedCount, 0),
    totalCount,
  };
}
