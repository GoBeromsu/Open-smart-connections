import type SmartConnectionsPlugin from '../main';
import { getBlockConnections } from './block-connections';
import type { ConnectionsReader } from '../types/connections-reader';

const DEFAULT_KERNEL_PHASE = 'idle';

function getAdapterFingerprint(plugin: SmartConnectionsPlugin): string | null {
  const runtimeFingerprint = plugin.getEmbedRuntimeState?.()?.snapshot?.modelFingerprint;
  if (runtimeFingerprint) return runtimeFingerprint;

  const searchAdapter = plugin._search_embed_model as { fingerprint?: string } | undefined;
  return searchAdapter?.fingerprint ?? null;
}

export function createConnectionsReader(plugin: SmartConnectionsPlugin): ConnectionsReader {
  return {
    isReady: () => Boolean(plugin.ready && plugin.block_collection),
    isEmbedReady: () => Boolean(plugin.embed_ready),
    getStatusState: () => plugin.status_state ?? '',
    hasPendingReImport: (path) => plugin.pendingReImportPaths?.has(path) ?? false,
    getBlocksForSource: (path) => plugin.block_collection?.for_source(path) ?? [],
    getSource: (path) => plugin.source_collection?.get(path) ?? null,
    ensureBlocksForSource: async (path: string) => {
      const blocks = plugin.block_collection?.for_source(path) ?? [];
      if (blocks.length > 0) return blocks;

      const source = plugin.source_collection?.get(path) ?? null;
      if (!source || !plugin.block_collection) return [];

      await plugin.block_collection.import_source_blocks(source);
      await plugin.block_collection.data_adapter.save();
      return plugin.block_collection.for_source(path);
    },
    getConnectionsForSource: async (path: string, limit = 50) => {
      if (!plugin.block_collection) return [];
      return await getBlockConnections(plugin.block_collection, path, { limit });
    },
    getEmbedRuntimeState: () => plugin.getEmbedRuntimeState?.() ?? null,
    getSearchModelFingerprint: () => getAdapterFingerprint(plugin),
    getKernelPhase: () => plugin.getEmbedRuntimeState?.()?.snapshot?.phase ?? plugin._embed_state?.phase ?? DEFAULT_KERNEL_PHASE,
    isDiscovering: () => Boolean((plugin as SmartConnectionsPlugin & { _discovering?: boolean })._discovering),
  };
}
