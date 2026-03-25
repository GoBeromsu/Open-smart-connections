/**
 * @file settings-model-picker.ts
 * @description Model dropdown rendering logic extracted from settings.ts
 */

import { Setting, Notice } from 'obsidian';
import { TRANSFORMERS_EMBED_MODELS } from './embed-adapters/transformers';
import { embedAdapterRegistry } from '../domain/embed-model';

interface ConfirmReembedFn {
  (message: string): Promise<boolean>;
}

interface ConfigAccessor {
  getConfig<T>(path: string, fallback: T): T;
  setConfig(path: string, value: unknown): void;
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
    .filter((key) => !(configuredOrder as string[]).includes(key))
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
  const result: Record<string, Array<{ value: string; name: string }>> = {
    transformers: getTransformersKnownModels(),
    ollama: OLLAMA_QUICK_PICKS,
  };

  // Derive model lists from registry for all static-model adapters
  for (const reg of embedAdapterRegistry.getAll()) {
    if (reg.name === 'transformers' || reg.name === 'ollama') continue;
    const opts = embedAdapterRegistry.getModelPickerOptions(reg.name);
    if (opts.length > 0) {
      result[reg.name] = opts;
    }
  }

  return result;
}

function renderOllamaModelPicker(deps: ModelPickerDeps, currentModelKey: string): void {
  const { containerEl, adapterName, config, confirmReembed, triggerReEmbed } = deps;
  const ollamaModels = OLLAMA_QUICK_PICKS;
  const isQuickPick = ollamaModels.some((m) => m.value === currentModelKey);
  let pendingModelKey = currentModelKey;

  new Setting(containerEl)
    .setName('Quick picks')
    .setDesc('Recommended ollama embedding models')

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
    .setDesc('Use quick picks or enter any local ollama embedding model key')
    .addText((text) => {
      text.setPlaceholder('E.g., bge-m3');
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
 * Validate the API key for a given adapter by running a test embed_batch call.
 * Updates statusEl with success/error feedback.
 */
/** Apply validation result to the status element without stripping Obsidian's base classes. */
function setValidationStatus(
  statusEl: HTMLElement,
  text: string,
  cls: 'osc-api-validation-ok' | 'osc-api-validation-error',
): void {
  statusEl.textContent = text;
  statusEl.classList.remove('osc-api-validation-ok', 'osc-api-validation-error');
  statusEl.classList.add(cls);
}

/**
 * Validate the API key for a given adapter by running a test embed_batch call.
 * Updates statusEl with success/error feedback.
 */
async function validateApiKey(
  adapterName: string,
  config: ConfigAccessor,
  statusEl: HTMLElement,
): Promise<void> {
  const apiKey = config.getConfig(`smart_sources.embed_model.${adapterName}.api_key`, '');
  const modelKey = config.getConfig(`smart_sources.embed_model.${adapterName}.model_key`, '');

  if (!apiKey) {
    setValidationStatus(statusEl, 'No API key set', 'osc-api-validation-error');
    return;
  }

  const adapterSettings: Record<string, unknown> = {
    [`${adapterName}.api_key`]: apiKey,
    api_key: apiKey,
  };

  const host = config.getConfig(`smart_sources.embed_model.${adapterName}.host`, '');
  if (host) adapterSettings.host = host;

  try {
    const { adapter } = embedAdapterRegistry.createAdapter(adapterName, modelKey, adapterSettings);
    if (typeof adapter.test_api_key !== 'function') {
      setValidationStatus(statusEl, 'Adapter does not support validation', 'osc-api-validation-error');
      return;
    }
    await adapter.test_api_key();
    setValidationStatus(statusEl, 'API key valid', 'osc-api-validation-ok');
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    setValidationStatus(statusEl, `Error: ${msg}`, 'osc-api-validation-error');
    new Notice(`API key validation failed: ${msg}`);
  }
}

/**
 * Render the API key field with debounce, trim validation, and a Validate button.
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

  // Show signup link from registry
  const reg = embedAdapterRegistry.get(adapterName);
  const signupUrl = reg?.signupUrl;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const setting = new Setting(containerEl)
    .setName('API key')
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
    })
    .addButton((button) => {
      button.setButtonText('Validate');
      button.onClick(async () => {
        // Flush debounced API key write so validation uses the latest value
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
          const inputEl = setting.controlEl.querySelector('input[type="password"]') as HTMLInputElement | null;
          if (inputEl) {
            const trimmed = inputEl.value.trim();
            if (trimmed !== currentApiKey) {
              config.setConfig(`smart_sources.embed_model.${adapterName}.api_key`, trimmed);
            }
          }
        }
        button.setButtonText('Validating...').setDisabled(true);
        try {
          await validateApiKey(adapterName, config, validationStatus);
        } finally {
          button.setButtonText('Validate').setDisabled(false);
        }
      });
    });

  // Dedicated status element for validation feedback (preserves descEl children)
  const validationStatus = setting.descEl.createEl('span', { cls: 'osc-api-validation-status' });

  // Add "Get API key" link below the description text
  if (signupUrl) {
    setting.descEl.createEl('br');
    const linkEl = setting.descEl.createEl('a', {
      text: `Get ${reg?.displayName ?? adapterName} API key`,
      href: signupUrl,
      cls: 'osc-signup-link',
    });
    linkEl.setAttr('target', '_blank');
  }
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

// ── Search Model Picker ─────────────────────────────────────────────

interface SearchModelPickerDeps {
  containerEl: HTMLElement;
  config: ConfigAccessor;
  onChanged: () => void;
  display: () => void;
}

/** Resolve dims for a given adapter + model_key from the registry. */
function resolveModelDims(adapterName: string, modelKey: string): number | null {
  const reg = embedAdapterRegistry.get(adapterName);
  if (!reg) return null;
  const info = reg.models[modelKey];
  return info?.dims ?? null;
}

type DimsSignal = 'ok' | 'warn' | 'error';

function computeDimsSignal(
  indexingAdapter: string,
  indexingDims: number | null,
  searchAdapter: string,
  searchDims: number | null,
): DimsSignal {
  if (indexingDims == null || searchDims == null) return 'ok';
  if (indexingDims !== searchDims) return 'error';
  if (indexingAdapter !== searchAdapter) return 'warn';
  return 'ok';
}

const DIMS_SIGNAL_TOOLTIPS: Record<DimsSignal, string> = {
  ok: 'Same provider and dimensions — fully compatible',
  warn: 'Different provider but same dimensions — should work, verify quality',
  error: 'Dimension mismatch — search results will be incompatible',
};

/**
 * Render the search model picker section with dims compatibility signal.
 * Wrapped in a collapsible <details> element to keep the settings page clean.
 */
export function renderSearchModelPicker(deps: SearchModelPickerDeps): void {
  const { containerEl, config, onChanged, display } = deps;

  const indexingAdapter = config.getConfig('smart_sources.embed_model.adapter', 'transformers');
  const indexingModelKey = config.getConfig(
    `smart_sources.embed_model.${indexingAdapter}.model_key`,
    '',
  );
  const indexingDims = resolveModelDims(indexingAdapter, indexingModelKey);

  const searchAdapter = config.getConfig('smart_sources.search_model.adapter', '');
  const searchModelKey = config.getConfig('smart_sources.search_model.model_key', '');
  const isSearchModelSet = searchAdapter !== '' && searchModelKey !== '';

  // Collapsible wrapper — collapsed by default
  const details = containerEl.createEl('details', { cls: 'osc-advanced-section' });
  // Keep open if a search model is already configured so the user can see it
  if (isSearchModelSet) details.open = true;
  details.createEl('summary', { text: 'Advanced: search model' });

  // Provider dropdown
  new Setting(details)
    .setName('Search provider')
    .setDesc('Provider used for search queries. "same as indexing" uses the indexing model.')
    .addDropdown((dropdown) => {
      dropdown.addOption('', 'Same as indexing');

      for (const reg of embedAdapterRegistry.getAll()) {
        dropdown.addOption(reg.name, reg.displayName);
      }

      dropdown.setValue(searchAdapter);
      dropdown.onChange((value) => {
        if (value === '') {
          // Clear search model — revert to indexing model
          config.setConfig('smart_sources.search_model', undefined);
          onChanged();
          display();
          return;
        }

        // Set provider, auto-select first model
        const reg = embedAdapterRegistry.get(value);
        const firstModelKey = reg ? Object.keys(reg.models)[0] ?? '' : '';
        config.setConfig('smart_sources.search_model', {
          adapter: value,
          model_key: firstModelKey,
        });
        onChanged();
        display();
      });
    });

  // Model dropdown (only when a search provider is selected)
  if (isSearchModelSet) {
    const allKnownModels = getKnownModels();
    const searchModels = allKnownModels[searchAdapter] ?? [];

    if (searchModels.length > 0) {
      new Setting(details)
        .setName('Search model')
        .setDesc('Model used for embedding search queries')
        .addDropdown((dropdown) => {
          for (const m of searchModels) {
            dropdown.addOption(m.value, m.name);
          }
          dropdown.setValue(searchModelKey);
          dropdown.onChange((value) => {
            config.setConfig('smart_sources.search_model', {
              adapter: searchAdapter,
              model_key: value,
            });
            onChanged();
            display();
          });
        });
    }

    // Dims comparison signal
    const searchDims = resolveModelDims(searchAdapter, searchModelKey);
    const signal = computeDimsSignal(indexingAdapter, indexingDims, searchAdapter, searchDims);

    const dimsRow = details.createDiv({ cls: 'osc-dims-row' });

    const indexLabel = dimsRow.createSpan({
      text: `Indexing: ${indexingDims != null ? `${indexingDims}d` : '?'}`,
      cls: 'osc-dims-ok',
    });
    indexLabel.setAttribute('aria-label', 'Indexing model dimensions');

    const searchLabel = dimsRow.createSpan({
      text: `Search: ${searchDims != null ? `${searchDims}d` : '?'}`,
      cls: `osc-dims-${signal}`,
    });
    searchLabel.setAttribute('aria-label', DIMS_SIGNAL_TOOLTIPS[signal]);
    searchLabel.title = DIMS_SIGNAL_TOOLTIPS[signal];
  }
}
