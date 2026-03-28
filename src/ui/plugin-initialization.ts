import type SmartConnectionsPlugin from '../main';
import {
  detectStaleSourcesOnStartup,
  initCollections,
  loadCollections,
  processNewSourcesChunked,
  importBlocksChunked,
  queueUnembeddedEntities,
} from './collection-loader';
import { debounceReImport, registerFileWatchers } from './file-watcher';
import { isCurrentLifecycle } from './plugin-lifecycle';
import { setupStatusBar } from './status-bar';
import { handleNewUser, loadUserState } from './user-state';

async function runInitStep(
  plugin: SmartConnectionsPlugin,
  lifecycle: number,
  name: string,
  fn: () => void | Promise<void>,
  critical = false,
): Promise<boolean> {
  try {
    await fn();
    return isCurrentLifecycle(plugin, lifecycle);
  } catch (error) {
    if (!isCurrentLifecycle(plugin, lifecycle)) {
      return false;
    }
    plugin.init_errors.push({ phase: name, error: error as Error });
    plugin.logger.error(`[SC][Init] ${name} failed:`, error);
    if (critical) {
      plugin.ready = false;
      plugin.setEmbedPhase('error', { error: `Failed: ${name}` });
    }
    return false;
  }
}

export async function initializePlugin(
  plugin: SmartConnectionsPlugin,
  lifecycle: number = plugin._lifecycle_epoch,
): Promise<void> {
  if (!isCurrentLifecycle(plugin, lifecycle)) return;

  plugin.logger.debug('[SC][Init] ▶ Initialization starting');
  await plugin.initializeCore(lifecycle);
  if (!isCurrentLifecycle(plugin, lifecycle)) return;

  void plugin.initializeEmbedding(lifecycle)
    .then(() => {
      if (!isCurrentLifecycle(plugin, lifecycle)) return;
      void handleNewUser(plugin);
    })
    .catch((error) => {
      plugin.logger.error('Background embedding init failed:', error);
    });
}

export async function initializeCore(
  plugin: SmartConnectionsPlugin,
  lifecycle: number = plugin._lifecycle_epoch,
): Promise<void> {
  if (!isCurrentLifecycle(plugin, lifecycle)) return;

  const start = performance.now();
  plugin.logger.debug('[SC][Init] ▶ Phase 1: Core initialization');
  setupStatusBar(plugin);

  await runInitStep(plugin, lifecycle, 'Load user state', () => loadUserState(plugin));
  if (!isCurrentLifecycle(plugin, lifecycle)) return;
  await runInitStep(plugin, lifecycle, 'Wait for sync', () => waitForSync(plugin));
  if (!isCurrentLifecycle(plugin, lifecycle)) return;
  if (!await runInitStep(plugin, lifecycle, 'Init collections', () => initCollections(plugin), true)) return;
  if (!isCurrentLifecycle(plugin, lifecycle)) return;
  if (!await runInitStep(plugin, lifecycle, 'Load collections', () => loadCollections(plugin), true)) return;
  if (!isCurrentLifecycle(plugin, lifecycle)) return;
  void detectStaleSourcesOnStartup(plugin);
  if (!isCurrentLifecycle(plugin, lifecycle)) return;
  await runInitStep(plugin, lifecycle, 'Register file watchers', () => registerFileWatchers(plugin));
  if (!isCurrentLifecycle(plugin, lifecycle)) return;

  plugin.ready = true;
  plugin.refreshStatus();
  plugin.app.workspace.trigger('open-connections:core-ready');

  const sourceCount = plugin.source_collection?.size ?? 0;
  const blockCount = plugin.block_collection?.size ?? 0;
  plugin.logger.debug(
    `[SC][Init] ✓ Phase 1 complete (${(performance.now() - start).toFixed(0)}ms) — ${sourceCount} sources, ${blockCount} blocks`,
  );
}

export async function initializeEmbedding(
  plugin: SmartConnectionsPlugin,
  lifecycle: number = plugin._lifecycle_epoch,
): Promise<void> {
  if (!isCurrentLifecycle(plugin, lifecycle)) return;
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  if (!isCurrentLifecycle(plugin, lifecycle)) return;

  const start = performance.now();
  plugin.logger.debug('[SC][Init] ▶ Phase 2: Embedding initialization');

  try {
    if (!isCurrentLifecycle(plugin, lifecycle)) return;
    await plugin.switchEmbeddingModel('Initial embedding setup');
    if (!isCurrentLifecycle(plugin, lifecycle)) return;
    await processNewSourcesChunked(plugin);
    if (!isCurrentLifecycle(plugin, lifecycle)) return;

    if (!plugin._unloading && plugin.pendingReImportPaths.size > 0) {
      plugin.logger.debug(`[SC][Init] Processing ${plugin.pendingReImportPaths.size} stale sources from startup detection`);
      debounceReImport(plugin);
    }
    if (!isCurrentLifecycle(plugin, lifecycle)) return;

    if (plugin.embedding_pipeline && !plugin._unloading) {
      const resumeCount = queueUnembeddedEntities(plugin);
      if (resumeCount > 0) {
        plugin.logger.debug(`[SC][Init] Resuming ${resumeCount} stranded unembedded blocks`);
        await plugin.runEmbeddingJob('[startup] resume stranded blocks');
      }
    }
    if (!isCurrentLifecycle(plugin, lifecycle)) return;

    plugin.logger.debug(`[SC][Init] ✓ Phase 2 complete (${(performance.now() - start).toFixed(0)}ms`);

    // Phase 3: Background block import — deferred so UI stays responsive
    if (!plugin._unloading && isCurrentLifecycle(plugin, lifecycle)) {
      setTimeout(() => {
        void (async () => {
          if (plugin._unloading || !isCurrentLifecycle(plugin, lifecycle)) return;
          plugin.logger.debug('[SC][Init] ▶ Phase 3: Background block import');
          await importBlocksChunked(plugin);
          if (plugin._unloading || !isCurrentLifecycle(plugin, lifecycle)) return;
          const queued = queueUnembeddedEntities(plugin);
          if (queued > 0 && plugin.embedding_pipeline) {
            plugin.logger.debug(`[SC][Init] Phase 3: ${queued} blocks to embed`);
            await plugin.runEmbeddingJob('[phase3] background block embed');
          }
          plugin.logger.debug('[SC][Init] ✓ Phase 3 complete');
        })();
      }, 5000);
    }
  } catch (error) {
    if (!isCurrentLifecycle(plugin, lifecycle)) return;
    plugin.init_errors.push({ phase: 'initializeEmbedding', error: error as Error });
    plugin.logger.error('[SC][Init] ✗ Phase 2 failed:', error);
    plugin.setEmbedPhase('error', { error: error instanceof Error ? error.message : String(error) });
  }
}

export async function waitForSync(plugin: SmartConnectionsPlugin): Promise<void> {
  if (!obsidianIsSyncing(plugin)) return;

  plugin.logger.debug('[SC][Init] Waiting for Obsidian Sync to finish...');
  const deadline = Date.now() + 60_000;
  await new Promise((resolve) => setTimeout(resolve, 1000));

  while (obsidianIsSyncing(plugin)) {
    if (plugin._unloading) {
      plugin.logger.warn('[SC][Init] Plugin unloading during sync wait, aborting');
      return;
    }
    if (Date.now() > deadline) {
      plugin.logger.warn('[SC][Init] Sync wait timed out after 60s, proceeding without sync completion');
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  plugin.logger.debug('[SC][Init] Obsidian Sync complete');
}

export function obsidianIsSyncing(plugin: SmartConnectionsPlugin): boolean {
  const syncInstance = plugin.app.internalPlugins?.plugins?.sync?.instance;
  if (!syncInstance) return false;
  if (syncInstance.syncStatus?.startsWith('Uploading')) return false;
  if (syncInstance.syncStatus?.startsWith('Fully synced')) return false;
  return syncInstance.syncing ?? false;
}
