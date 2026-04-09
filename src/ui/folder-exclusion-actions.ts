import { TFile } from 'obsidian';

import type { SmartConnectionsPlugin } from './settings-types';

function normalizeFolderPath(value: string): string {
  return value
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+|\/+$/g, '');
}

function isPathInsideFolder(path: string, folderPath: string): boolean {
  const normalizedPath = normalizeFolderPath(path);
  const normalizedFolder = normalizeFolderPath(folderPath);
  if (!normalizedFolder) return false;
  return normalizedPath === normalizedFolder || normalizedPath.startsWith(`${normalizedFolder}/`);
}

function getVaultSourcePathsInFolder(plugin: SmartConnectionsPlugin, folderPath: string): string[] {
  const normalizedFolder = normalizeFolderPath(folderPath);
  if (!normalizedFolder) return [];

  const loadedFiles = plugin.app.vault.getAllLoadedFiles?.() ?? [];
  return loadedFiles
    .filter((entry): entry is TFile => entry instanceof TFile)
    .filter((entry) => ['md', 'txt'].includes(entry.extension))
    .map((entry) => entry.path)
    .filter((path) => isPathInsideFolder(path, normalizedFolder));
}

function getExcludedFolders(plugin: SmartConnectionsPlugin): string[] {
  const raw = plugin.settings?.smart_sources.folder_exclusions ?? '';
  return raw
    .split(',')
    .map(normalizeFolderPath)
    .filter(Boolean);
}

function isEmbeddingRunActive(plugin: SmartConnectionsPlugin): boolean {
  return plugin.getEmbedRuntimeState?.().backfill.kind === 'running';
}

export function buildFolderExclusionConfirmMessage(
  folderPath: string,
  activeRun: boolean,
): string {
  const lines = [
    `Exclude "${folderPath}"?`,
    '',
    'Existing embeddings for this folder will be removed.',
  ];

  if (activeRun) {
    lines.push('', 'A run is already active, so this change will apply on the next run.');
  }

  return lines.join('\n');
}

async function reconcileExcludedFoldersNow(plugin: SmartConnectionsPlugin): Promise<void> {
  const excludedFolders = getExcludedFolders(plugin);
  const sourcePaths = (plugin.source_collection?.all ?? []).map((source) => source.key);
  const toRemove = sourcePaths.filter((path) =>
    excludedFolders.some((folder) => isPathInsideFolder(path, folder)),
  );

  for (const path of toRemove) {
    plugin.removeSource?.(path);
  }

  await plugin.source_collection?.data_adapter?.save?.();
  await plugin.block_collection?.data_adapter?.save?.();
  plugin.source_collection?.recomputeEmbeddedCount?.();
  plugin.block_collection?.recomputeEmbeddedCount?.();

  await plugin.processNewSourcesChunked?.();
  plugin.refreshStatus?.();
  plugin.app.workspace.trigger('open-connections:discovery-complete');
}

export async function queueExcludedFolderReconcile(
  plugin: SmartConnectionsPlugin,
  reason: string,
): Promise<void> {
  if (!plugin.enqueueEmbeddingJob) return;
  const activeRun = isEmbeddingRunActive(plugin);
  if (activeRun) {
    plugin.notices?.show?.('folder_exclusion_reconcile_deferred');
  }

  await plugin.enqueueEmbeddingJob({
    type: 'REFRESH_REQUEST',
    key: `RECONCILE_EXCLUDED_FOLDERS:${plugin.settings?.smart_sources.folder_exclusions ?? ''}`,
    priority: 25,
    run: async () => {
      await reconcileExcludedFoldersNow(plugin);
      plugin.notices?.show?.('folder_exclusion_reconcile_applied');
    },
  });

  plugin.logger?.info?.(`[SC] Scheduled folder exclusion reconcile: ${reason}`);
}

export async function queueRemovedFolderReembed(
  plugin: SmartConnectionsPlugin,
  folderPath: string,
): Promise<void> {
  const sourcePaths = getVaultSourcePathsInFolder(plugin, folderPath);
  for (const path of sourcePaths) {
    plugin.queueSourceReImport?.(path);
  }

  if (sourcePaths.length === 0) {
    await plugin.processNewSourcesChunked?.();
  }

  plugin.refreshStatus?.();
  plugin.app.workspace.trigger('open-connections:discovery-complete');
}
