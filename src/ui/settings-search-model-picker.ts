import { Setting } from 'obsidian';

import type { SearchModelPickerDeps } from './settings-model-picker-shared';
import { getKnownModels, resolveModelDims } from './settings-model-picker-shared';
import { embedAdapterRegistry } from '../domain/embed-model';

type DimsSignal = 'ok' | 'warn' | 'error';

const DIMS_SIGNAL_TOOLTIPS: Record<DimsSignal, string> = {
  ok: 'Same provider and dimensions — fully compatible',
  warn: 'Different provider but same dimensions — should work, verify quality',
  error: 'Dimension mismatch — search results will be incompatible',
};

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

export function renderSearchModelPicker(deps: SearchModelPickerDeps): void {
  const { containerEl, config, onChanged, display } = deps;
  const indexingAdapter = config.getConfig('smart_sources.embed_model.adapter', 'transformers');
  const indexingModelKey = config.getConfig(`smart_sources.embed_model.${indexingAdapter}.model_key`, '');
  const indexingDims = resolveModelDims(indexingAdapter, indexingModelKey);
  const searchAdapter = config.getConfig('smart_sources.search_model.adapter', '');
  const searchModelKey = config.getConfig('smart_sources.search_model.model_key', '');
  const isSearchModelSet = searchAdapter !== '' && searchModelKey !== '';

  const details = containerEl.createEl('details', { cls: 'osc-advanced-section' });
  if (isSearchModelSet) details.open = true;
  details.createEl('summary', { text: 'Advanced: search model' });

  new Setting(details)
    .setName('Search provider')
    .setDesc('Provider used for search queries. "same as indexing" uses the indexing model.')
    .addDropdown((dropdown) => {
      dropdown.addOption('', 'Same as indexing');
      for (const registration of embedAdapterRegistry.getAll()) {
        dropdown.addOption(registration.name, registration.displayName);
      }
      dropdown.setValue(searchAdapter);
      dropdown.onChange((value) => {
        if (value === '') {
          config.setConfig('smart_sources.search_model', undefined);
          onChanged();
          display();
          return;
        }
        const registration = embedAdapterRegistry.get(value);
        const firstModelKey = registration ? Object.keys(registration.models)[0] ?? '' : '';
        config.setConfig('smart_sources.search_model', {
          adapter: value,
          model_key: firstModelKey,
        });
        onChanged();
        display();
      });
    });

  if (!isSearchModelSet) return;

  const searchModels = getKnownModels()[searchAdapter] ?? [];
  if (searchModels.length > 0) {
    new Setting(details)
      .setName('Search model')
      .setDesc('Model used for embedding search queries')
      .addDropdown((dropdown) => {
        for (const model of searchModels) {
          dropdown.addOption(model.value, model.name);
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
