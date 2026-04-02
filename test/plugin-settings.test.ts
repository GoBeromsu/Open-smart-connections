import { describe, expect, it } from 'vitest';
import { hydratePluginSettings } from '../src/domain/plugin-settings';

describe('hydratePluginSettings', () => {
  it('preserves defaults when plugin data is missing', () => {
    const normalized = hydratePluginSettings(null);
    expect(normalized.settings.smart_sources.embed_model.adapter).toBe('transformers');
    expect(normalized.settings.mcp.port).toBe(27124);
  });

  it('normalizes upstage indexing model to passage mode', () => {
    const normalized = hydratePluginSettings({
      settings: {
        smart_sources: {
          embed_model: {
            adapter: 'upstage',
            upstage: {
              api_key: 'secret',
              model_key: 'embedding-query',
            },
          },
        },
      },
    } as Record<string, unknown>);

    const embedModel = normalized.settings.smart_sources.embed_model as Record<string, unknown>;
    const upstage = embedModel.upstage as Record<string, unknown>;
    expect(upstage.model_key).toBe('embedding-passage');
    expect(normalized.removedLegacyKeys).toBe(true);
  });
});
