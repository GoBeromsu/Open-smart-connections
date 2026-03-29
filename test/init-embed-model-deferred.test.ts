import { describe, expect, it, vi } from 'vitest';

import { embedAdapterRegistry } from '../src/domain/embed-model';
import { initEmbedModel } from '../src/ui/embed-orchestrator';

function createPluginStub() {
  return {
    settings: {
      smart_sources: {
        embed_model: {
          adapter: 'transformers',
          transformers: { model_key: 'TaylorAI/bge-micro-v2' },
        },
      },
    },
    getEmbedAdapterSettings: vi.fn((embedSettings?: Record<string, unknown>) => {
      if (!embedSettings) return {};
      const adapterType = embedSettings.adapter;
      return typeof adapterType === 'string'
        ? ((embedSettings[adapterType] as Record<string, unknown>) ?? {})
        : {};
    }),
    logger: {
      info: vi.fn(),
      error: vi.fn(),
    },
    notices: {
      show: vi.fn(),
    },
    embed_adapter: undefined,
  } as any;
}

describe('initEmbedModel', () => {
  it('creates the transformers adapter without eagerly loading the model', async () => {
    const plugin = createPluginStub();

    await initEmbedModel(plugin);

    expect(plugin.embed_adapter).toBeTruthy();
    expect(plugin.embed_adapter.loaded).toBe(false);
    expect(plugin.logger.info).toHaveBeenCalledWith(
      expect.stringContaining('load deferred to first use'),
    );
  });

  it('still eagerly loads non-transformers adapters that require load()', async () => {
    const load = vi.fn(async () => {});
    const adapter = {
      adapter: 'custom',
      model_key: 'custom-model',
      dims: 1,
      load,
    };
    vi.spyOn(embedAdapterRegistry, 'createAdapter').mockReturnValue({
      adapter: adapter as any,
      requiresLoad: true,
    });

    const plugin = {
      settings: {
        smart_sources: {
          embed_model: {
            adapter: 'custom',
            custom: { model_key: 'custom-model' },
          },
        },
      },
      getEmbedAdapterSettings: vi.fn(() => ({ model_key: 'custom-model' })),
      logger: { info: vi.fn(), error: vi.fn() },
      notices: { show: vi.fn() },
      embed_adapter: undefined,
    } as any;

    await initEmbedModel(plugin);

    expect(load).toHaveBeenCalledTimes(1);
    expect(plugin.embed_adapter).toBe(adapter);
  });
});
