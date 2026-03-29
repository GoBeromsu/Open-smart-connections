import type SmartConnectionsPlugin from '../main';
import { closeNodeSqliteDatabases } from '../domain/entities';
import { clearEmbedNotice } from './embed-orchestrator';
import { beginLifecycle, resetTransientRuntimeState } from './plugin-lifecycle';

export function cleanupPlugin(plugin: SmartConnectionsPlugin): void {
  plugin.logger.debug('Unloading Open Connections plugin');
  beginLifecycle(plugin);
  plugin._unloading = true;

  plugin.embedding_pipeline?.halt();
  clearEmbedNotice(plugin);
  plugin._notices?.unload();

  if (plugin.re_import_timeout) {
    window.clearTimeout(plugin.re_import_timeout);
    plugin.re_import_timeout = undefined;
  }

  if (plugin._search_embed_model?.unload) {
    plugin._search_embed_model.unload().catch((error: unknown) => {
      plugin.logger.warn('Failed to unload search embed model', { error });
    });
  }

  if (plugin.embed_adapter?.unload) {
    plugin.embed_adapter.unload().catch((error: unknown) => {
      plugin.logger.warn('Failed to unload embed model', { error });
    });
  }

  const sourceAdapter = plugin.source_collection?.data_adapter;
  const blockAdapter = plugin.block_collection?.data_adapter;
  resetTransientRuntimeState(plugin);

  if (sourceAdapter) {
    sourceAdapter.save().catch((error: unknown) => plugin.logger.warn('[SC] Flush source save failed', { error }));
  }
  if (blockAdapter) {
    blockAdapter.save().catch((error: unknown) => plugin.logger.warn('[SC] Flush block save failed', { error }));
  }

  closeNodeSqliteDatabases();
}
