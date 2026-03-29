/**
 * @file file-watcher.ts
 * @description File system event handlers and re-import management.
 *              Changed paths are collected in pendingReImportPaths (Set<string>)
 *              and processed via the kernel job queue for serialization.
 */

import { TFile } from 'obsidian';
import type SmartConnectionsPlugin from '../main';
import { invalidateConnectionsCache } from './block-connections';
import { isExcludedPath } from '../utils';
import { logEmbed, runEmbeddingJobNow } from './embed-orchestrator';

export function registerFileWatchers(plugin: SmartConnectionsPlugin): void {
  function handleSourceChange(file: TFile): void {
    if ((plugin as unknown as { _discovering?: boolean })._discovering) return;
    if (isSourceFile(file, plugin)) {
      invalidateConnectionsCache(file.path);
      queueSourceReImport(plugin, file.path);
    }
  }

  plugin.registerEvent(
    plugin.app.vault.on('create', (file) => {
      if (file instanceof TFile) handleSourceChange(file);
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile) handleSourceChange(file);
      if (oldPath) {
        invalidateConnectionsCache(oldPath);
        removeSource(plugin, oldPath);
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on('modify', (file) => {
      if (file instanceof TFile) handleSourceChange(file);
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on('delete', (file) => {
      if (file instanceof TFile && isSourceFile(file, plugin)) {
        removeSource(plugin, file.path);
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.workspace.on('editor-change', () => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile || !isSourceFile(activeFile, plugin)) return;
      debounceReImport(plugin);
    }),
  );

  plugin.registerEvent(
    plugin.app.workspace.on('active-leaf-change', () => {
      const activeFile = plugin.app.workspace.getActiveFile();
      if (!activeFile || !isSourceFile(activeFile, plugin)) return;
      debounceReImport(plugin);
    }),
  );
}

const SUPPORTED_EXTENSIONS = new Set(['md', 'txt']);

export function isSourceFile(file: TFile, plugin?: SmartConnectionsPlugin): boolean {
  if (!SUPPORTED_EXTENSIONS.has(file.extension)) return false;
  const folderExclusions = (plugin?.settings?.smart_sources?.folder_exclusions as string) || "";
  const fileExclusions = (plugin?.settings?.smart_sources?.file_exclusions as string) || "";
  return !isExcludedPath(file.path, folderExclusions, fileExclusions);
}

export function queueSourceReImport(plugin: SmartConnectionsPlugin, path: string): void {
  plugin.pendingReImportPaths.add(path);
  debounceReImport(plugin);
}

export function removeSource(plugin: SmartConnectionsPlugin, path: string): void {
  invalidateConnectionsCache(path);
  plugin.pendingReImportPaths.delete(path);
  plugin.source_collection?.delete(path);
  plugin.block_collection?.delete_source_blocks(path);
}

export function debounceReImport(plugin: SmartConnectionsPlugin): void {
  if (plugin.re_import_timeout) {
    window.clearTimeout(plugin.re_import_timeout);
  }

  const waitTime = (plugin.settings.re_import_wait_time || 13) * 1000;
  plugin.re_import_timeout = window.setTimeout(() => {
    void enqueueReImportJob(plugin).catch((error: unknown) => {
      plugin.logger.error('Failed to enqueue debounced re-import', error);
    });
  }, waitTime);
}

function enqueueReImportJob(plugin: SmartConnectionsPlugin): Promise<void> {
  return plugin.enqueueEmbeddingJob({
    type: 'REIMPORT_SOURCES',
    key: 'REIMPORT_SOURCES',
    priority: 20,
    run: () => runReImport(plugin),
  });
}

export async function runReImport(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!plugin.source_collection || !plugin.embedding_pipeline) {
    plugin.logger.warn('Collections or pipeline not initialized');
    return;
  }

  // Drain pending paths atomically
  const paths = [...plugin.pendingReImportPaths];
  plugin.pendingReImportPaths.clear();
  if (paths.length === 0) return;

  plugin.logger.info(`Re-importing ${paths.length} sources...`);

  try {
    if (plugin.status_msg) {
      plugin.status_msg.setText(`Processing ${paths.length} files...`);
    }

    for (const path of paths) {
      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await plugin.source_collection.import_source(file);
      }
    }

    const staleQueued = plugin.queueUnembeddedEntities();
    logEmbed(plugin, 'reimport-queue-ready', {
      reason: 'run-reimport',
      current: staleQueued,
      total: staleQueued,
    });

    // Safe: runReImport runs INSIDE a kernel queue job (REIMPORT_SOURCES),
    // so calling runEmbeddingJobNow directly avoids deadlock.
    await runEmbeddingJobNow(plugin, `Re-import (${paths.length} files)`);

    plugin.refreshStatus();
    plugin.logger.info('Re-import completed');

    // If new paths were added during processing, re-enqueue
    if (!plugin._unloading && plugin.pendingReImportPaths.size > 0) {
      void enqueueReImportJob(plugin).catch((error: unknown) => {
        plugin.logger.error('Failed to re-enqueue re-import', error);
      });
    }
  } catch (error) {
    plugin.logger.error('Re-import failed', error);
    plugin.setEmbedPhase('error', { error: error instanceof Error ? error.message : String(error) });
    plugin.notices.show('reimport_failed');
    plugin.refreshStatus();
  }
}
