import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GEMINI_EMBED_MODEL_KEY,
  GeminiEmbedAdapter,
  GEMINI_EMBED_MODELS,
} from '../src/ui/embed-adapters/gemini';

function makeAdapter(model_key: string): GeminiEmbedAdapter {
  return new GeminiEmbedAdapter({
    adapter: 'gemini',
    model_key,
    dims: 768,
    models: GEMINI_EMBED_MODELS,
    settings: { api_key: 'test-key' },
  });
}

describe('GeminiEmbedAdapter', () => {
  it('keeps the supported default Gemini model key wired to the batch endpoint', () => {
    const adapter = makeAdapter(DEFAULT_GEMINI_EMBED_MODEL_KEY);

    expect(adapter.get_model_info()?.endpoint).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_EMBED_MODEL_KEY}:batchEmbedContents`,
    );
  });

  it('creates model info for custom Gemini model keys on demand', () => {
    const customModelKey = 'gemini-embedding-2-preview';
    const adapter = makeAdapter(customModelKey);

    expect(adapter.get_model_info()?.endpoint).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${customModelKey}:batchEmbedContents`,
    );
    expect(adapter.get_model_info()?.dims).toBe(768);
  });
});
