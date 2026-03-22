/**
 * @file settings-reembed.test.ts
 * @description Regression tests for re-embed status transitions in settings tab
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { App, Setting } from 'obsidian';
import { SmartConnectionsSettingsTab } from '../src/ui/settings';
import { renderModelDropdown } from '../src/ui/settings-model-picker';

describe('SmartConnectionsSettingsTab.triggerReEmbed', () => {
  let app: App;
  let plugin: any;
  let tab: SmartConnectionsSettingsTab;

  beforeEach(() => {
    app = new App();
    (app as any).workspace.trigger = vi.fn();

    plugin = {
      settings: {},
      saveSettings: vi.fn(),
      switchEmbeddingModel: vi.fn(async () => {}),
      notices: {
        show: vi.fn(),
      },
      embed_ready: true,
      status_state: 'idle',
    };

    tab = new SmartConnectionsSettingsTab(app, plugin as any);
    vi.spyOn(tab, 'display').mockImplementation(() => {});
  });

  it('should set error state when re-embed initialization fails', async () => {
    plugin.switchEmbeddingModel.mockRejectedValue(new Error('boom'));

    await (tab as any).triggerReEmbed();

    expect(plugin.switchEmbeddingModel).toHaveBeenCalledWith('Settings model switch');
    expect(plugin.notices.show).toHaveBeenCalledWith('failed_reinitialize_model');
  });

  it('should call model switch and show success notice when re-embed succeeds', async () => {
    await (tab as any).triggerReEmbed();

    expect(plugin.switchEmbeddingModel).toHaveBeenCalledWith('Settings model switch');
    expect(plugin.notices.show).toHaveBeenCalledWith('embedding_model_switched');
  });

});

describe('SmartConnectionsSettingsTab model options', () => {
  let app: App;
  let plugin: any;
  let tab: SmartConnectionsSettingsTab;

  beforeEach(() => {
    app = new App();
    (app as any).workspace.trigger = vi.fn();
    (Setting as any).reset?.();

    plugin = {
      settings: {
        smart_sources: {
          embed_model: {
            adapter: 'ollama',
            ollama: { model_key: 'nomic-embed-text' },
            transformers: { model_key: 'TaylorAI/bge-micro-v2' },
          },
        },
        smart_blocks: {},
      },
      saveSettings: vi.fn(async () => {}),
    };

    tab = new SmartConnectionsSettingsTab(app, plugin as any);
  });

  it('updates model key and re-embeds when an ollama quick pick is selected', async () => {
    const confirmSpy = vi.spyOn(tab as any, 'confirmReembed').mockResolvedValue(true);
    const reembedSpy = vi.spyOn(tab as any, 'triggerReEmbed').mockResolvedValue(undefined);
    const containerEl = document.createElement('div');

    renderModelDropdown({
      containerEl,
      adapterName: 'ollama',
      config: {
        getConfig: (path: string, fallback: any) => (tab as any).getConfig(path, fallback),
        setConfig: (path: string, value: any) => (tab as any).setConfig(path, value),
      },
      confirmReembed: (msg: string) => (tab as any).confirmReembed(msg),
      triggerReEmbed: () => (tab as any).triggerReEmbed(),
      display: () => tab.display(),
    });

    const quickPickSetting = (Setting as any).instances.find((item: any) => item.name === 'Quick picks');
    expect(quickPickSetting).toBeDefined();

    await quickPickSetting.dropdown.trigger('bge-m3');

    expect(confirmSpy).toHaveBeenCalled();
    expect(plugin.settings.smart_sources.embed_model.ollama.model_key).toBe('bge-m3');
    expect(reembedSpy).toHaveBeenCalled();
  });
});
