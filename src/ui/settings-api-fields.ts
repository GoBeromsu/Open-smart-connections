import { Notice, Setting } from 'obsidian';

import type { ConfigAccessor } from './settings-model-picker-shared';
import { embedAdapterRegistry } from '../domain/embed-model';

function setValidationStatus(
  statusEl: HTMLElement,
  text: string,
  cls: 'osc-api-validation-ok' | 'osc-api-validation-error',
): void {
  statusEl.textContent = text;
  statusEl.classList.remove('osc-api-validation-ok', 'osc-api-validation-error');
  statusEl.classList.add(cls);
}

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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    setValidationStatus(statusEl, `Error: ${message}`, 'osc-api-validation-error');
    new Notice(`API key validation failed: ${message}`);
  }
}

export function renderApiKeyField(
  containerEl: HTMLElement,
  adapterName: string,
  config: ConfigAccessor,
): void {
  const currentApiKey = config.getConfig(`smart_sources.embed_model.${adapterName}.api_key`, '');
  const registration = embedAdapterRegistry.get(adapterName);
  const signupUrl = registration?.signupUrl;
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
          if (trimmed !== currentApiKey) {
            config.setConfig(`smart_sources.embed_model.${adapterName}.api_key`, trimmed);
          }
        }, 500);
      });
    })
    .addButton((button) => {
      button.setButtonText('Validate');
      button.onClick(async () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
          const inputEl = setting.controlEl.querySelector<HTMLInputElement>('input[type="password"]');
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

  const validationStatus = setting.descEl.createEl('span', { cls: 'osc-api-validation-status' });
  if (!signupUrl) return;
  setting.descEl.createEl('br');
  const linkEl = setting.descEl.createEl('a', {
    text: `Get ${registration?.displayName ?? adapterName} API key`,
    href: signupUrl,
    cls: 'osc-signup-link',
  });
  linkEl.setAttr('target', '_blank');
}

export function renderHostField(
  containerEl: HTMLElement,
  adapterName: string,
  defaultHost: string,
  config: ConfigAccessor,
): void {
  const currentHost = config.getConfig(`smart_sources.embed_model.${adapterName}.host`, defaultHost);
  new Setting(containerEl)
    .setName('Host URL')
    .setDesc('API endpoint URL')
    .addText((text) => {
      text.setPlaceholder(defaultHost);
      text.setValue(currentHost);
      text.onChange((value) => {
        config.setConfig(`smart_sources.embed_model.${adapterName}.host`, value);
      });
    });
}
