import { Setting } from 'obsidian';

import type { ModelPickerDeps } from './settings-model-picker-shared';
import { getKnownModels } from './settings-model-picker-shared';
import { renderFreeformModelInput } from './settings-model-dropdown-freeform';
import { renderKnownModelDropdown } from './settings-model-dropdown-known';
import { renderOllamaModelPicker } from './settings-model-dropdown-ollama';

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
