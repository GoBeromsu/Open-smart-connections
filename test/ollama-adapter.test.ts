import { describe, expect, it } from 'vitest';

import { OllamaEmbedAdapter } from '../src/ui/embed-adapters/ollama';

describe('OllamaEmbedAdapter safeguards', () => {
  it('uses a conservative default max token budget before model metadata loads', () => {
    const adapter = new OllamaEmbedAdapter({
      adapter: 'ollama',
      model_key: 'nomic-embed-text',
      dims: 768,
      models: {},
      settings: {},
    });

    expect(adapter.max_tokens).toBe(2048);
  });
});
