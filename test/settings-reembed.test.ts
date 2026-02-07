/**
 * @file settings-reembed.test.ts
 * @description Regression tests for re-embed status transitions in settings tab
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { App } from 'obsidian';
import { SmartConnectionsSettingsTab } from '../src/settings';

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
      embedding_pipeline: {
        is_active: vi.fn(() => false),
      },
      initEmbedModel: vi.fn(async () => {}),
      syncCollectionEmbeddingContext: vi.fn(),
      initPipeline: vi.fn(async () => {}),
      queueUnembeddedEntities: vi.fn(() => 2),
      processInitialEmbedQueue: vi.fn(async () => {}),
      requestEmbeddingStop: vi.fn(() => true),
      waitForEmbeddingToStop: vi.fn(async () => true),
      refreshStatus: vi.fn(),
      embed_ready: true,
      status_state: 'idle',
    };

    tab = new SmartConnectionsSettingsTab(app, plugin as any);
    vi.spyOn(tab, 'display').mockImplementation(() => {});
  });

  it('should set error state when re-embed initialization fails', async () => {
    plugin.initEmbedModel.mockRejectedValue(new Error('boom'));

    await (tab as any).triggerReEmbed();

    expect(plugin.embed_ready).toBe(false);
    expect(plugin.status_state).toBe('error');
    expect(plugin.refreshStatus).toHaveBeenCalled();
    expect((app as any).workspace.trigger).not.toHaveBeenCalledWith(
      'smart-connections:embed-ready',
      expect.anything(),
    );
  });

  it('should set idle state and emit ready event when re-embed initialization succeeds', async () => {
    await (tab as any).triggerReEmbed();

    expect(plugin.status_state).toBe('idle');
    expect(plugin.embed_ready).toBe(true);
    expect(plugin.refreshStatus).toHaveBeenCalled();
    expect((app as any).workspace.trigger).toHaveBeenCalledWith(
      'smart-connections:embed-ready',
    );
    expect(plugin.queueUnembeddedEntities).toHaveBeenCalled();
    expect(plugin.processInitialEmbedQueue).toHaveBeenCalled();
  });

  it('should stop active embedding before switching model', async () => {
    plugin.embedding_pipeline.is_active.mockReturnValue(true);

    await (tab as any).triggerReEmbed();

    expect(plugin.requestEmbeddingStop).toHaveBeenCalledWith(
      'Embedding model switch requested',
    );
    expect(plugin.waitForEmbeddingToStop).toHaveBeenCalled();
    expect(plugin.initEmbedModel).toHaveBeenCalled();
  });
});
