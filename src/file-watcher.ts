/**
 * @file file-watcher.ts
 * @description File system event handlers and re-import queue management
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
  if (!plugin.re_import_queue[path]) {
    plugin.re_import_queue[path] = { path, queued_at: Date.now() };
    debounceReImport(plugin);
  }
}

export function removeSource(plugin: SmartConnectionsPlugin, path: string): void {
  delete plugin.re_import_queue[path];

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

function deferReImport(plugin: SmartConnectionsPlugin, reason: string, delayMs: number = 1500): void {
  console.log(`${reason}. Deferring re-import for ${delayMs}ms...`);
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

function enqueueReImportJob(plugin: SmartConnectionsPlugin, reason: string): Promise<void> {
  return plugin.enqueueEmbeddingJob({
    type: 'REIMPORT_SOURCES',
    key: 'REIMPORT_SOURCES',
    priority: 20,
    run: async () => {
      await runReImport(plugin);
    },
  });
}

export async function runReImport(plugin: SmartConnectionsPlugin, forceWhilePaused: boolean = false): Promise<void> {
  plugin.re_import_halted = false;
  plugin.dispatchKernelEvent({ type: 'REIMPORT_REQUESTED', reason: 'runReImport' });

  if (!plugin.source_collection || !plugin.embedding_pipeline) {
    console.warn('Collections or pipeline not initialized');
    return;
  }

  if (plugin.status_state === 'paused' && !forceWhilePaused) {
    plugin.logEmbed('reimport-skip-paused');
    return;
  }

  if (plugin.embedding_pipeline.is_active()) {
    if (plugin.status_msg) {
      plugin.status_msg.setText('SC: Embedding in progress, updates queued');
    }
    deferReImport(plugin, 'Embedding pipeline is already processing');
    return;
  }

  const queue_paths = Object.keys(plugin.re_import_queue);
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

    processed_paths.forEach((path) => {
      if (plugin.re_import_queue[path]) {
        delete plugin.re_import_queue[path];
      }
    });

    plugin.refreshStatus();
    console.log('Re-import completed');
    plugin.dispatchKernelEvent({ type: 'REIMPORT_COMPLETED' });

    if (Object.keys(plugin.re_import_queue).length > 0) {
      deferReImport(plugin, 'Re-import queue still has pending updates');
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Embedding pipeline is already processing')
    ) {
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
