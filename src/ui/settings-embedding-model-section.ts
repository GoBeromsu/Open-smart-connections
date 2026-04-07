import { Setting } from 'obsidian';

import {
  getDefaultEmbedModelKey,
  getManagedSearchModel,
  shouldClearManagedSearchModel,
} from '../domain/embed-provider-policy';
import {
  renderApiKeyField,
  renderHostField,
  renderModelDropdown,
  renderSearchModelPicker,
} from './settings-model-picker';
import type { SettingsConfigAccessor, SmartConnectionsPlugin } from './settings-types';

function ensureModelKeyForAdapter(config: SettingsConfigAccessor, adapterName: string): void {
  const existing = config.getConfig(`smart_sources.embed_model.${adapterName}.model_key`, '');
  if (typeof existing === 'string' && existing.trim().length > 0) {
    applyManagedSearchModel(config, adapterName);
    return;
  }

  const fallback = getDefaultEmbedModelKey(adapterName);
  if (!fallback) return;
  config.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, fallback);
  applyManagedSearchModel(config, adapterName);
}

function applyManagedSearchModel(config: SettingsConfigAccessor, adapterName: string): void {
  const searchModel = getManagedSearchModel(adapterName);
  if (searchModel) {
    config.setConfig('smart_sources.search_model', searchModel);
  }
}

function clearManagedSearchModelIfStale(config: SettingsConfigAccessor, newAdapter: string): void {
  if (newAdapter === 'upstage') return;
  const searchModel = config.getConfig<{ adapter?: string; model_key?: string } | null>('smart_sources.search_model', null);
  if (shouldClearManagedSearchModel(searchModel, newAdapter)) {
    config.setConfig('smart_sources.search_model', undefined);
  }
}

function triggerSearchModelReInit(plugin: SmartConnectionsPlugin): void {
  plugin.switchEmbeddingModel?.('Search model changed').catch(() => {
    // Search model re-init failure is non-critical.
  });
}

export function renderEmbeddingModelSection(
  containerEl: HTMLElement,
  plugin: SmartConnectionsPlugin,
  config: SettingsConfigAccessor,
  confirmReembed: (message: string) => Promise<boolean>,
  triggerReEmbed: () => Promise<void>,
  display: () => void,
): void {
  const currentAdapter = config.getConfig<string>('smart_sources.embed_model.adapter', 'transformers');

  new Setting(containerEl)
    .setName('Provider')
    .setDesc('Embedding model provider')
    .addDropdown((dropdown) => {
      const providers = [
        { value: 'transformers', name: 'Transformers (Local)' },
        { value: 'openai', name: 'OpenAI' },
        { value: 'ollama', name: 'Ollama (Local)' },
        { value: 'gemini', name: 'Google Gemini' },
        { value: 'lm_studio', name: 'LM Studio (Local)' },
        { value: 'upstage', name: 'Upstage' },
        { value: 'open_router', name: 'Open Router' },
      ];
      for (const provider of providers) {
        dropdown.addOption(provider.value, provider.name);
      }
      dropdown.setValue(currentAdapter);
      dropdown.onChange((value) => {
        void (async () => {
          if (value !== currentAdapter) {
            const confirmed = await confirmReembed(
              'Changing the embedding provider requires re-embedding all notes. This may take a while. Continue?',
            );
            if (!confirmed) {
              dropdown.setValue(currentAdapter);
              return;
            }
          }

          config.setConfig('smart_sources.embed_model.adapter', value);
          ensureModelKeyForAdapter(config, value);
          clearManagedSearchModelIfStale(config, value);
          display();
          await triggerReEmbed();
        })();
      });
    });

  renderModelDropdown({
    containerEl,
    adapterName: currentAdapter,
    config,
    confirmReembed,
    triggerReEmbed,
    display,
  });

  if (['openai', 'gemini', 'upstage', 'open_router'].includes(currentAdapter)) {
    renderApiKeyField(containerEl, currentAdapter, config);
  }

  if (['ollama', 'lm_studio'].includes(currentAdapter)) {
    const defaultHost = currentAdapter === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234';
    renderHostField(containerEl, currentAdapter, defaultHost, config);
  }

  renderSearchModelPicker({
    containerEl,
    config,
    onChanged: () => triggerSearchModelReInit(plugin),
    display,
  });
}
