/**
 * @file settings-model-picker.ts
 * @description Model dropdown rendering logic extracted from settings.ts
 */

import { Setting } from 'obsidian';
import { TRANSFORMERS_EMBED_MODELS } from '../shared/models/embed/adapters/transformers';

interface ConfirmReembedFn {
  (message: string): Promise<boolean>;
}

interface ConfigAccessor {
  getConfig(path: string, fallback: any): any;
  setConfig(path: string, value: any): void;
}

interface ModelPickerDeps {
  containerEl: HTMLElement;
  adapterName: string;
  config: ConfigAccessor;
  confirmReembed: ConfirmReembedFn;
  triggerReEmbed: () => Promise<void>;
  display: () => void;
}

const OLLAMA_QUICK_PICKS: Array<{ value: string; name: string }> = [
  { value: 'bge-m3', name: 'bge-m3' },
  { value: 'nomic-embed-text', name: 'nomic-embed-text' },
  { value: 'snowflake-arctic-embed2', name: 'snowflake-arctic-embed2' },
  { value: 'mxbai-embed-large', name: 'mxbai-embed-large' },
];

const TRANSFORMERS_MODEL_ORDER = [
  'TaylorAI/bge-micro-v2',
  'Xenova/bge-m3',
  'Xenova/multilingual-e5-large',
  'Xenova/multilingual-e5-small',
  'Xenova/paraphrase-multilingual-MiniLM-L12-v2',
  'nomic-ai/nomic-embed-text-v1.5',
  'Xenova/bge-small-en-v1.5',
  'Snowflake/snowflake-arctic-embed-xs',
  'Snowflake/snowflake-arctic-embed-s',
  'Snowflake/snowflake-arctic-embed-m',
  'Xenova/jina-embeddings-v2-small-en',
  'Xenova/jina-embeddings-v2-base-zh',
  'andersonbcdefg/bge-small-4096',
  'TaylorAI/gte-tiny',
  'onnx-community/embeddinggemma-300m-ONNX',
  'Mihaiii/Ivysaur',
  'nomic-ai/nomic-embed-text-v1',
] as const;

export function getTransformersKnownModels(): Array<{ value: string; name: string }> {
  const configuredOrder = TRANSFORMERS_MODEL_ORDER.filter((key) => !!TRANSFORMERS_EMBED_MODELS[key]);
  const remaining = Object.keys(TRANSFORMERS_EMBED_MODELS)
    .filter((key) => !configuredOrder.includes(key as any))
    .sort((a, b) => a.localeCompare(b));
  const orderedKeys = [...configuredOrder, ...remaining];

  return orderedKeys.map((modelKey) => {
    const model = TRANSFORMERS_EMBED_MODELS[modelKey];
    const dims = model?.dims ? `${model.dims}d` : 'dims?';
    const modelName = model?.model_name || modelKey.split('/').pop() || modelKey;
    return {
      value: modelKey,
      name: `${modelName} (${dims})`,
    };
  });
}

function getKnownModels(): Record<string, Array<{ value: string; name: string }>> {
  return {
    transformers: getTransformersKnownModels(),
    ollama: OLLAMA_QUICK_PICKS,
    openai: [
      { value: 'text-embedding-3-small', name: 'text-embedding-3-small (1536d)' },
      { value: 'text-embedding-3-large', name: 'text-embedding-3-large (3072d)' },
      { value: 'text-embedding-ada-002', name: 'text-embedding-ada-002 (1536d)' },
    ],
    gemini: [
      { value: 'text-embedding-004', name: 'text-embedding-004 (768d)' },
    ],
    upstage: [
      { value: 'solar-embedding-1-large-passage', name: 'Solar Embedding Large Passage' },
      { value: 'solar-embedding-1-large-query', name: 'Solar Embedding Large Query' },
    ],
  };
}

function renderOllamaModelPicker(deps: ModelPickerDeps, currentModelKey: string): void {
  const { containerEl, adapterName, config, confirmReembed, triggerReEmbed } = deps;
  const ollamaModels = OLLAMA_QUICK_PICKS;
  const isQuickPick = ollamaModels.some((m) => m.value === currentModelKey);
  let pendingModelKey = currentModelKey;

  new Setting(containerEl)
    .setName('Quick picks')
    .setDesc('Recommended Ollama embedding models')
    .addDropdown((dropdown) => {
      ollamaModels.forEach((m) => {
        dropdown.addOption(m.value, m.name);
      });
      dropdown.addOption('__manual__', 'Manual entry...');
      dropdown.setValue(isQuickPick ? currentModelKey : '__manual__');
      dropdown.onChange(async (value) => {
        if (value === '__manual__') return;
        if (value === currentModelKey) {
          pendingModelKey = value;
          return;
        }

        const confirmed = await confirmReembed(
          'Changing the embedding model requires re-embedding all notes. This may take a while. Continue?',
        );
        if (!confirmed) {
          dropdown.setValue(isQuickPick ? currentModelKey : '__manual__');
          return;
        }

        config.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, value);
        await triggerReEmbed();
      });
    });

  new Setting(containerEl)
    .setName('Model key')
    .setDesc('Use quick picks or enter any local Ollama embedding model key')
    .addText((text) => {
      text.setPlaceholder('e.g., bge-m3');
      text.setValue(currentModelKey);
      text.onChange((value) => {
        pendingModelKey = value.trim();
      });
    })
    .addButton((button) => {
      button.setButtonText('Apply');
      button.setCta();
      button.onClick(async () => {
        if (!pendingModelKey || pendingModelKey === currentModelKey) return;
        const confirmed = await confirmReembed(
          'Changing the embedding model requires re-embedding all notes. Continue?',
        );
        if (!confirmed) return;
        config.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, pendingModelKey);
        await triggerReEmbed();
      });
    });
}

function renderKnownModelDropdown(deps: ModelPickerDeps, currentModelKey: string, knownModels: Array<{ value: string; name: string }>): void {
  const { containerEl, adapterName, config, confirmReembed, triggerReEmbed, display } = deps;
  const isCustom = !knownModels.some((m) => m.value === currentModelKey) && currentModelKey !== '';

  new Setting(containerEl)
    .setName('Model')
    .setDesc('Embedding model')
    .addDropdown((dropdown) => {
      knownModels.forEach((m) => {
        dropdown.addOption(m.value, m.name);
      });
      dropdown.addOption('__custom__', 'Custom...');
      dropdown.setValue(isCustom ? '__custom__' : currentModelKey);
      dropdown.onChange(async (value) => {
        if (value === '__custom__') {
          display();
          return;
        }
        const oldValue = currentModelKey;
        if (value !== oldValue) {
          const confirmed = await confirmReembed(
            'Changing the embedding model requires re-embedding all notes. This may take a while. Continue?',
          );
          if (!confirmed) {
            dropdown.setValue(isCustom ? '__custom__' : oldValue);
            return;
          }
        }
        config.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, value);
        await triggerReEmbed();
      });
    });

  // Show text input for custom model
  if (isCustom || config.getConfig(`smart_sources.embed_model.${adapterName}.model_key`, '') === '__custom__') {
    let pendingCustomModel = isCustom ? currentModelKey : '';
    new Setting(containerEl)
      .setName('Custom model key')
      .setDesc('Enter a custom model identifier')
      .addText((text) => {
        text.setPlaceholder('e.g., org/model-name');
        text.setValue(pendingCustomModel);
        text.onChange((value) => {
          pendingCustomModel = value.trim();
        });
      })
      .addButton((button) => {
        button.setButtonText('Apply');
        button.setCta();
        button.onClick(async () => {
          const nextValue = pendingCustomModel.trim();
          if (!nextValue || nextValue === currentModelKey) return;
          const confirmed = await confirmReembed(
            'Applying a custom embedding model requires re-embedding notes. Continue?',
          );
          if (!confirmed) return;
          config.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, nextValue);
          await triggerReEmbed();
        });
      });
  }
}

function renderFreeformModelInput(deps: ModelPickerDeps, currentModelKey: string): void {
  const { containerEl, adapterName, config, confirmReembed, triggerReEmbed } = deps;
  let pendingModelKey = currentModelKey;

  new Setting(containerEl)
    .setName('Model')
    .setDesc('Embedding model key')
    .addText((text) => {
      text.setPlaceholder(adapterName === 'ollama' ? 'nomic-embed-text' : 'Model key');
      text.setValue(currentModelKey);
      text.onChange((value) => {
        pendingModelKey = value.trim();
      });
    })
    .addButton((button) => {
      button.setButtonText('Apply');
      button.setCta();
      button.onClick(async () => {
        if (!pendingModelKey || pendingModelKey === currentModelKey) return;
        const confirmed = await confirmReembed(
          'Changing the embedding model requires re-embedding all notes. Continue?',
        );
        if (!confirmed) return;
        config.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, pendingModelKey);
        await triggerReEmbed();
      });
    });
}

/**
 * Render the model dropdown for the given adapter.
 * Delegates to Ollama-specific, known-model, or freeform input renderers.
 */
export function renderModelDropdown(deps: ModelPickerDeps): void {
  const { adapterName, config } = deps;
  const currentModelKey = config.getConfig(
    `smart_sources.embed_model.${adapterName}.model_key`,
    '',
  );

  if (adapterName === 'ollama') {
    renderOllamaModelPicker(deps, currentModelKey);
    return;
  }

  const allKnownModels = getKnownModels();
  const knownModels = allKnownModels[adapterName];

  if (knownModels) {
    renderKnownModelDropdown(deps, currentModelKey, knownModels);
  } else {
    renderFreeformModelInput(deps, currentModelKey);
  }
}

/**
 * Render the API key field with debounce and trim validation.
 */
export function renderApiKeyField(
  containerEl: HTMLElement,
  adapterName: string,
  config: ConfigAccessor,
): void {
  const currentApiKey = config.getConfig(
    `smart_sources.embed_model.${adapterName}.api_key`,
    '',
  );

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  new Setting(containerEl)
    .setName('API Key')
    .setDesc('API key for authentication')
    .addText((text) => {
      text.inputEl.type = 'password';
      text.setPlaceholder('Enter API key');
      text.setValue(currentApiKey);
      text.onChange((value) => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          const trimmed = value.trim();
          if (trimmed === currentApiKey) return;
          config.setConfig(`smart_sources.embed_model.${adapterName}.api_key`, trimmed);
        }, 500);
      });
    });
}

/**
 * Render the host URL field for local adapters.
 */
export function renderHostField(
  containerEl: HTMLElement,
  adapterName: string,
  defaultHost: string,
  config: ConfigAccessor,
): void {
  const currentHost = config.getConfig(
    `smart_sources.embed_model.${adapterName}.host`,
    defaultHost,
  );

  new Setting(containerEl)
    .setName('Host URL')
    .setDesc('API endpoint URL')
    .addText((text) => {
      text.setPlaceholder(defaultHost);
      text.setValue(currentHost);
      text.onChange(async (value) => {
        config.setConfig(`smart_sources.embed_model.${adapterName}.host`, value);
      });
    });
}
