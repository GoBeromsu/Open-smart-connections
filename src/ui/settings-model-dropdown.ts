import { Setting } from 'obsidian';

import type { ModelPickerDeps } from './settings-model-picker-shared';
import { getKnownModels, OLLAMA_QUICK_PICKS } from './settings-model-picker-shared';
import { renderOllamaModelPicker } from './settings-model-dropdown-ollama';

function renderKnownModelDropdown(
  deps: ModelPickerDeps,
  currentModelKey: string,
  knownModels: Array<{ value: string; name: string }>,
): void {
  const { containerEl, adapterName, config, confirmReembed, triggerReEmbed, display } = deps;
  const customModeFlag = 'oscCustomModelOpen';
  const isCustom = !knownModels.some((model) => model.value === currentModelKey) && currentModelKey !== '';
  const isCustomModeOpen = containerEl.dataset[customModeFlag] === adapterName;
  const showCustomInput = isCustom || isCustomModeOpen
    || config.getConfig<string>(`smart_sources.embed_model.${adapterName}.model_key`, '') === '__custom__';

  new Setting(containerEl)
    .setName('Model')
    .setDesc('Embedding model')
    .addDropdown((dropdown) => {
      for (const model of knownModels) {
        dropdown.addOption(model.value, model.name);
      }
      dropdown.addOption('__custom__', 'Custom...');
      dropdown.setValue(showCustomInput ? '__custom__' : currentModelKey);
      dropdown.onChange(async (value) => {
        if (value === '__custom__') {
          containerEl.dataset[customModeFlag] = adapterName;
          display();
          return;
        }
        delete containerEl.dataset[customModeFlag];
        if (value !== currentModelKey) {
          const confirmed = await confirmReembed(
            'Changing the embedding model requires re-embedding all notes. This may take a while. Continue?',
          );
          if (!confirmed) {
            if (showCustomInput) {
              containerEl.dataset[customModeFlag] = adapterName;
            }
            dropdown.setValue(showCustomInput ? '__custom__' : currentModelKey);
            return;
          }
        }
        config.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, value);
        await triggerReEmbed();
      });
    });

  if (!showCustomInput) {
    return;
  }

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
      button.setButtonText('Apply').setCta();
      button.onClick(async () => {
        const nextValue = pendingCustomModel.trim();
        if (!nextValue || nextValue === currentModelKey) return;
        const confirmed = await confirmReembed(
          'Applying a custom embedding model requires re-embedding notes. Continue?',
        );
        if (!confirmed) return;
        delete containerEl.dataset[customModeFlag];
        config.setConfig(`smart_sources.embed_model.${adapterName}.model_key`, nextValue);
        await triggerReEmbed();
      });
    });
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
      button.setButtonText('Apply').setCta();
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

export function renderModelDropdown(deps: ModelPickerDeps): void {
  const currentModelKey = deps.config.getConfig(
    `smart_sources.embed_model.${deps.adapterName}.model_key`,
    '',
  );
  if (deps.adapterName === 'ollama') {
    renderOllamaModelPicker(deps, currentModelKey);
    return;
  }

  const knownModels = getKnownModels()[deps.adapterName];
  if (knownModels) {
    renderKnownModelDropdown(deps, currentModelKey, knownModels);
    return;
  }

  renderFreeformModelInput(deps, currentModelKey);
}
