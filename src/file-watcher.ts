/**
 * @file file-watcher.ts
 * @description File system event handlers and re-import queue management.
 *              Uses EmbedJobQueue as the single source of truth for pending re-imports.
 */

import { TFile } from 'obsidian';
import type SmartConnectionsPlugin from './main';

export function registerFileWatchers(plugin: SmartConnectionsPlugin): void {
  plugin.registerEvent(
    plugin.app.vault.on('create', (file) => {
      if (file instanceof TFile && isSourceFile(file)) {
        queueSourceReImport(plugin, file.path);
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile && isSourceFile(file)) {
        queueSourceReImport(plugin, file.path);
      }
      if (oldPath) {
        removeSource(plugin, oldPath);
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on('modify', (file) => {
      if (file instanceof TFile && isSourceFile(file)) {
        queueSourceReImport(plugin, file.path);
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on('delete', (file) => {
      if (file instanceof TFile && isSourceFile(file)) {
        removeSource(plugin, file.path);
      }
    }),
  );

  plugin.registerEvent(
    plugin.app.workspace.on('editor-change', () => {
      debounceReImport(plugin);
    }),
  );

  plugin.registerEvent(
    plugin.app.workspace.on('active-leaf-change', () => {
      debounceReImport(plugin);
    }),
  );
}

export function isSourceFile(file: TFile): boolean {
  const supportedExtensions = ['md', 'txt'];
  return supportedExtensions.some((ext) => file.path.endsWith(`.${ext}`));
}

export function queueSourceReImport(plugin: SmartConnectionsPlugin, path: string): void {
  // Enqueue into the unified EmbedJobQueue. LWW dedup ensures rapid edits
  // to the same file collapse into one entry with the latest timestamp.
  plugin.embed_job_queue?.enqueue({
    entityKey: path,
    contentHash: '', // unknown until file is imported
    sourcePath: path.split('#')[0],
    enqueuedAt: Date.now(),
  });
  debounceReImport(plugin);
}

export function removeSource(plugin: SmartConnectionsPlugin, path: string): void {
  // Remove from the unified queue (source + all block keys under this source)
  plugin.embed_job_queue?.removeBySourcePath(path);

  if (plugin.source_collection) {
    plugin.source_collection.delete(path);
  }

  if (plugin.block_collection) {
    plugin.block_collection.delete_source_blocks(path);
  }
}

export function debounceReImport(plugin: SmartConnectionsPlugin): void {
  plugin.re_import_halted = true;
  if (plugin.re_import_timeout) {
    window.clearTimeout(plugin.re_import_timeout);
  }
  if (plugin.re_import_retry_timeout) {
    window.clearTimeout(plugin.re_import_retry_timeout);
    plugin.re_import_retry_timeout = undefined;
  }

  const waitTime = (plugin.settings.re_import_wait_time || 13) * 1000;
  plugin.re_import_timeout = window.setTimeout(() => {
    void enqueueReImportJob(plugin, 'Debounced re-import').catch((error) => {
      console.error('Failed to enqueue debounced re-import:', error);
    });
  }, waitTime);

  plugin.refreshStatus();
}

const MAX_DEFER_RETRIES = 20;
let deferRetryCount = 0;

function deferReImport(plugin: SmartConnectionsPlugin, reason: string, delayMs: number = 1500): void {
  deferRetryCount++;
  if (deferRetryCount > MAX_DEFER_RETRIES) {
    console.warn(`[SC] Re-import deferred ${deferRetryCount} times — giving up. Reason: ${reason}`);
    deferRetryCount = 0;
    return;
  }
  console.log(`${reason}. Deferring re-import for ${delayMs}ms (attempt ${deferRetryCount}/${MAX_DEFER_RETRIES})...`);
  if (plugin.re_import_retry_timeout) {
    window.clearTimeout(plugin.re_import_retry_timeout);
  }
  plugin.re_import_retry_timeout = window.setTimeout(() => {
    plugin.re_import_retry_timeout = undefined;
    void enqueueReImportJob(plugin, reason).catch((error) => {
      console.error('Failed to enqueue deferred re-import:', error);
    });
  }, delayMs);
}

function resetDeferRetryCount(): void {
  deferRetryCount = 0;
}

function enqueueReImportJob(plugin: SmartConnectionsPlugin, _reason: string): Promise<void> {
  return plugin.enqueueEmbeddingJob({
    type: 'REIMPORT_SOURCES',
    key: 'REIMPORT_SOURCES',
    priority: 20,
    run: async () => {
      await runReImport(plugin);
    },
  });
}

/**
 * Collect source-level file paths from the EmbedJobQueue.
 * Only returns entries whose entityKey looks like a source path (no '#' block ref).
 */
function getReImportPaths(plugin: SmartConnectionsPlugin): string[] {
  if (!plugin.embed_job_queue) return [];
  return plugin.embed_job_queue
    .toArray()
    .filter((j) => !j.entityKey.includes('#'))
    .map((j) => j.entityKey);
}

export async function runReImport(plugin: SmartConnectionsPlugin): Promise<void> {
  plugin.re_import_halted = false;
  plugin.dispatchKernelEvent({ type: 'REIMPORT_REQUESTED', reason: 'runReImport' });

  if (!plugin.source_collection || !plugin.embedding_pipeline) {
    console.warn('Collections or pipeline not initialized');
    return;
  }

  if (plugin.embedding_pipeline.is_active()) {
    if (plugin.status_msg) {
      plugin.status_msg.setText('SC: Embedding in progress, updates queued');
    }
    deferReImport(plugin, 'Embedding pipeline is already processing');
    return;
  }

  const queue_paths = getReImportPaths(plugin);
  if (queue_paths.length === 0) return;

  console.log(`Re-importing ${queue_paths.length} sources...`);
  const processed_paths: string[] = [];

  try {
    if (plugin.status_msg) {
      plugin.status_msg.setText(`Processing ${queue_paths.length} files...`);
    }

    for (const path of queue_paths) {
      if (plugin.re_import_halted) {
        console.log('Re-import halted by user');
        break;
      }

      const file = plugin.app.vault.getAbstractFileByPath(path);
      if (file instanceof TFile) {
        await plugin.source_collection.import_source(file);
      }
      processed_paths.push(path);
    }

    const staleQueued = plugin.queueUnembeddedEntities();
    plugin.logEmbed('reimport-queue-ready', {
      reason: 'run-reimport',
      current: staleQueued,
      total: staleQueued,
    });

    await plugin.runEmbeddingJobImmediate(`Re-import (${queue_paths.length} files)`);

    // Remove processed source-level entries from the queue
    for (const path of processed_paths) {
      plugin.embed_job_queue?.remove(path);
    }

    plugin.refreshStatus();
    resetDeferRetryCount();
    console.log('Re-import completed');
    plugin.dispatchKernelEvent({ type: 'REIMPORT_COMPLETED' });

    // If the queue still has source-level items, schedule another re-import
    if (getReImportPaths(plugin).length > 0) {
      deferReImport(plugin, 'Re-import queue still has pending updates');
    }
  } catch (error) {
    // Check if pipeline is busy — defer rather than fail
    const isBusy = plugin.embedding_pipeline?.is_active() ||
      (error instanceof Error && error.message.includes('already processing'));
    if (isBusy) {
      deferReImport(plugin, 'Embedding pipeline is already processing');
      return;
    }
    console.error('Re-import failed:', error);
    plugin.dispatchKernelEvent({
      type: 'REIMPORT_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
    plugin.notices.show('reimport_failed');
    plugin.refreshStatus();
  }
}
