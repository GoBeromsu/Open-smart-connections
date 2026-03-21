/**
 * @file file-watcher.ts
 * @description File system event handlers and re-import queue management.
 *              Uses EmbedJobQueue as the single source of truth for pending re-imports.
 */

import { TFile } from 'obsidian';
import type SmartConnectionsPlugin from '../main';

export function registerFileWatchers(plugin: SmartConnectionsPlugin): void {
  function handleSourceChange(file: TFile): void {
    if (isSourceFile(file)) {
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
      if (oldPath) removeSource(plugin, oldPath);
    }),
  );

  plugin.registerEvent(
    plugin.app.vault.on('modify', (file) => {
      if (file instanceof TFile) handleSourceChange(file);
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

const SUPPORTED_EXTENSIONS = new Set(['md', 'txt']);

export function isSourceFile(file: TFile): boolean {
  return SUPPORTED_EXTENSIONS.has(file.extension);
}

export function queueSourceReImport(plugin: SmartConnectionsPlugin, path: string): void {
  plugin.embed_job_queue?.enqueue({
    entityKey: path,
    contentHash: '',
    sourcePath: path.split('#')[0],
    enqueuedAt: Date.now(),
  });
  debounceReImport(plugin);
}

export function removeSource(plugin: SmartConnectionsPlugin, path: string): void {
  plugin.embed_job_queue?.removeBySourcePath(path);
  plugin.source_collection?.delete(path);
  plugin.block_collection?.delete_source_blocks(path);
}

export function debounceReImport(plugin: SmartConnectionsPlugin): void {
  if (plugin._chunked_pipeline_active) return;

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
    void enqueueReImportJob(plugin).catch((error) => {
      console.error('Failed to enqueue debounced re-import:', error);
    });
  }, waitTime);

  plugin.refreshStatus();
}

const MAX_DEFER_RETRIES = 20;

function deferReImport(plugin: SmartConnectionsPlugin, reason: string, delayMs: number = 1500): void {
  plugin._defer_retry_count++;
  if (plugin._defer_retry_count > MAX_DEFER_RETRIES) {
    console.warn(`[SC] Re-import deferred ${plugin._defer_retry_count} times — giving up. Reason: ${reason}`);
    plugin._defer_retry_count = 0;
    return;
  }
  console.log(`${reason}. Deferring re-import for ${delayMs}ms (attempt ${plugin._defer_retry_count}/${MAX_DEFER_RETRIES})...`);
  if (plugin.re_import_retry_timeout) {
    window.clearTimeout(plugin.re_import_retry_timeout);
  }
  plugin.re_import_retry_timeout = window.setTimeout(() => {
    plugin.re_import_retry_timeout = undefined;
    void enqueueReImportJob(plugin).catch((error) => {
      console.error('Failed to enqueue deferred re-import:', error);
    });
  }, delayMs);
}

function enqueueReImportJob(plugin: SmartConnectionsPlugin): Promise<void> {
  return plugin.enqueueEmbeddingJob({
    type: 'REIMPORT_SOURCES',
    key: 'REIMPORT_SOURCES',
    priority: 20,
    run: () => runReImport(plugin),
  });
}

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

  if (plugin._chunked_pipeline_active) {
    console.log('[SC] Re-import skipped: chunked pipeline is active, paths remain queued');
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

    for (const path of processed_paths) {
      plugin.embed_job_queue?.removeBySourcePath(path);
    }

    plugin.refreshStatus();
    plugin._defer_retry_count = 0;
    console.log('Re-import completed');
    plugin.dispatchKernelEvent({ type: 'REIMPORT_COMPLETED' });

    if (!plugin._unloading && getReImportPaths(plugin).length > 0) {
      deferReImport(plugin, 'Re-import queue still has pending updates');
    }
  } catch (error) {
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
