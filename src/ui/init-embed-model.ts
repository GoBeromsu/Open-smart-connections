import type SmartConnectionsPlugin from '../main';
import { embedAdapterRegistry } from '../domain/embed-model';
import { errorMessage } from '../utils';
import './register-embed-adapters';

function shouldDeferAdapterLoad(adapterType: string): boolean {
  return adapterType === 'transformers';
}

export async function initEmbedModel(plugin: SmartConnectionsPlugin): Promise<void> {
  try {
    const embedSettings = plugin.settings.smart_sources.embed_model;
    const adapterType = embedSettings.adapter;
    const adapterSettings = plugin.getEmbedAdapterSettings(embedSettings);
    const modelKey = (adapterSettings.model_key as string) || '';

    const { adapter, requiresLoad } = embedAdapterRegistry.createAdapter(
      adapterType,
      modelKey,
      adapterSettings,
    );

    if (requiresLoad && typeof (adapter as unknown as { load?: () => Promise<void> }).load === 'function') {
      if (shouldDeferAdapterLoad(adapterType)) {
        plugin.logger.info(`[Init] Embed model created (${adapterType}/${modelKey}) — load deferred to first use`);
      } else {
        await (adapter as unknown as { load: () => Promise<void> }).load();
      }
    }

    plugin.embed_adapter = adapter;
    plugin.logger.info(`[Init] Embed model initialized (${adapterType}/${modelKey})`);
  } catch (error) {
    plugin.logger.error('[Init] Failed to initialize embed model', error);
    const message = errorMessage(error);
    if (plugin.settings.smart_sources.embed_model.adapter === 'transformers') {
      if (/\[download:timeout\]/i.test(message)) {
        plugin.notices.show('failed_download_timeout', {}, { timeout: 10000 });
      } else if (/\[download:quota\]/i.test(message)) {
        plugin.notices.show('failed_download_quota', {}, { timeout: 10000 });
      } else if (/\[download:network\]/i.test(message)) {
        plugin.notices.show('failed_download_network', {}, { timeout: 10000 });
      } else if (/\[download:model_not_found\]/i.test(message)) {
        const modelKey = plugin.settings.smart_sources.embed_model.transformers?.model_key ?? 'unknown';
        plugin.notices.show('failed_download_model_not_found', { modelKey }, { timeout: 10000 });
      } else if (/(failed to fetch|network|cdn|timed out)/i.test(message)) {
        plugin.notices.show('failed_download_transformers_model', { error: message }, { timeout: 8000 });
      }
    }
    plugin.notices.show('failed_init_embed_model');
    throw error;
  }
}

export async function initSearchEmbedModel(plugin: SmartConnectionsPlugin): Promise<void> {
  const searchModelSettings = plugin.settings.smart_sources.search_model;
  if (!searchModelSettings?.adapter || !searchModelSettings?.model_key) {
    plugin._search_embed_model = undefined;
    return;
  }

  const embedSettings = plugin.settings.smart_sources.embed_model;
  const indexingAdapterSettings = plugin.getEmbedAdapterSettings(embedSettings);
  if (
    searchModelSettings.adapter === embedSettings.adapter &&
    searchModelSettings.model_key === (indexingAdapterSettings.model_key || '')
  ) {
    plugin._search_embed_model = undefined;
    return;
  }

  try {
    const searchAdapterSettings = searchModelSettings.adapter === embedSettings.adapter
      ? { ...indexingAdapterSettings }
      : { ...(embedSettings[searchModelSettings.adapter as keyof typeof embedSettings] as Record<string, unknown> || {}) };

    const { adapter, requiresLoad } = embedAdapterRegistry.createAdapter(
      searchModelSettings.adapter,
      searchModelSettings.model_key,
      searchAdapterSettings,
    );

    if (requiresLoad && typeof (adapter as unknown as { load?: () => Promise<void> }).load === 'function') {
      if (shouldDeferAdapterLoad(searchModelSettings.adapter)) {
        plugin.logger.info(
          `[Init] Search model created (${searchModelSettings.adapter}/${searchModelSettings.model_key}) — load deferred to first use`,
        );
      } else {
        await (adapter as unknown as { load: () => Promise<void> }).load();
      }
    }

    plugin._search_embed_model = adapter;
    plugin.logger.info(`[Init] Search model initialized (${searchModelSettings.adapter}/${searchModelSettings.model_key})`);
  } catch {
    plugin.logger.warn('[Init] Failed to initialize search model, will use indexing model');
    plugin._search_embed_model = undefined;
  }
}

export function getModelLoadTimeoutMs(plugin: SmartConnectionsPlugin): number {
  const embedModel = plugin.settings?.smart_sources?.embed_model;
  if (!embedModel) return 180000;
  const targetAdapterSettings = plugin.getEmbedAdapterSettings(embedModel);
  const configuredLoadTimeoutMs = Number(targetAdapterSettings?.request_timeout_ms);
  return Number.isFinite(configuredLoadTimeoutMs) && configuredLoadTimeoutMs > 0
    ? configuredLoadTimeoutMs
    : 180000;
}
