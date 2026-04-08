import type SmartConnectionsPlugin from '../../main';
import { buildKernelModel } from '../../domain/embedding/kernel';
import { errorMessage } from '../../utils';
import { saveCollections } from '../embed-collection-persistence';
import { getModelLoadTimeoutMs, initSearchEmbedModel } from '../init-embed-model';
import { getCurrentModelInfo } from '../embed-model-info';
import { withTimeout } from '../embed-timeout';

export async function switchEmbeddingModel(
  plugin: SmartConnectionsPlugin,
  reason: string = 'Embedding model switch',
): Promise<void> {
  await plugin.enqueueEmbeddingJob({
    type: 'MODEL_SWITCH',
    key: 'MODEL_SWITCH',
    priority: 5,
    run: () => switchEmbeddingModelNow(plugin, reason),
  });
}

async function unloadPreviousModel(plugin: SmartConnectionsPlugin): Promise<void> {
  if (plugin._search_embed_model?.unload) {
    try {
      await plugin._search_embed_model.unload();
    } catch (error) {
      plugin.logger.warn('Failed to unload previous search embed model during switch', { error: error instanceof Error ? error.message : String(error) });
    }
    plugin._search_embed_model = undefined;
  }

  if (!plugin.embed_adapter) return;
  try {
    await plugin.embed_adapter.unload?.();
  } catch (error) {
    plugin.logger.warn('Failed to unload previous embed model during switch', { error: error instanceof Error ? error.message : String(error) });
  }
}

async function switchEmbeddingModelNow(
  plugin: SmartConnectionsPlugin,
  reason: string,
): Promise<void> {
  plugin.resetError();
  const previous = getCurrentModelInfo(plugin);
  const previousModelKey = plugin.embed_adapter?.model_key ?? '';
  const embedModel = plugin.settings?.smart_sources?.embed_model;
  const targetAdapterSettings = embedModel ? plugin.getEmbedAdapterSettings(embedModel) : null;
  const targetAdapter = embedModel?.adapter ?? '';
  const targetModelKey = typeof targetAdapterSettings?.model_key === 'string' ? targetAdapterSettings.model_key : '';
  const shouldForceReembed = !!plugin.embed_adapter
    && (previousModelKey !== targetModelKey || previous.adapter !== targetAdapter);

  plugin.logEmbed('switch-start', { reason, ...previous });

  try {
    if (plugin.embedding_pipeline?.is_active()) {
      plugin.embedding_pipeline.halt();
      plugin.logEmbed('switch-halt-pipeline', { reason, ...previous });
    }

    await unloadPreviousModel(plugin);
    await withTimeout(
      plugin.initEmbedModel(),
      getModelLoadTimeoutMs(plugin),
      `Timed out while loading embedding model (${targetAdapter}/${targetModelKey}).`,
    );
    await initSearchEmbedModel(plugin);
    plugin.syncCollectionEmbeddingContext();

    if (shouldForceReembed) {
      let forced = 0;
      for (const entity of [...(plugin.source_collection?.all || []), ...(plugin.block_collection?.all || [])]) {
        if (!entity) continue;
        entity.set_active_embedding_meta?.({ hash: '' });
        entity.queue_embed?.();
        forced++;
      }
      plugin.logEmbed('switch-force-reembed', {
        reason,
        adapter: targetAdapter,
        modelKey: targetModelKey,
        current: forced,
        total: forced,
      });
    }

    const queuedAfterSync = plugin.queueUnembeddedEntities();
    if (queuedAfterSync > 0) {
      plugin.logEmbed('switch-queued', {
        adapter: targetAdapter,
        modelKey: targetModelKey,
        current: queuedAfterSync,
        total: queuedAfterSync,
      });
    }

    await saveCollections(plugin);
    await plugin.initPipeline();

    const active = getCurrentModelInfo(plugin);
    const activeEmbedModel = plugin.settings?.smart_sources?.embed_model;
    const activeAdapterSettings = activeEmbedModel ? plugin.getEmbedAdapterSettings(activeEmbedModel) : null;
    const kernelModel = buildKernelModel(
      active.adapter,
      active.modelKey,
      typeof activeAdapterSettings?.host === 'string' ? activeAdapterSettings.host : '',
      active.dims,
    );

    plugin.setEmbedPhase('idle', { fingerprint: kernelModel.fingerprint });
    plugin.app.workspace.trigger('open-connections:embed-ready');
    plugin.app.workspace.trigger('open-connections:model-switched', { ...active, switchedAt: Date.now() });
    plugin.logEmbed('switch-ready', { reason, ...active, current: queuedAfterSync, total: queuedAfterSync });
    plugin.logger.info('[SC][Init] Model switch complete', {
      adapter: active.adapter,
      modelKey: active.modelKey,
      queued: queuedAfterSync,
    });
  } catch (error) {
    plugin.setEmbedPhase('error', { error: errorMessage(error) });
    plugin.logEmbed('switch-failed', { reason, error: errorMessage(error) });
    throw error;
  }
}
