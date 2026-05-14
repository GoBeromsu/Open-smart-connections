import { describe, expect, it, vi } from 'vitest';

import { embed_api_batch } from '../src/ui/embed-adapters/api-adapter-batch';
import { LmStudioEmbedAdapter } from '../src/ui/embed-adapters/lm-studio';
import { OllamaEmbedAdapter } from '../src/ui/embed-adapters/ollama';
import { OpenAIEmbedAdapter, OPENAI_EMBED_MODELS } from '../src/ui/embed-adapters/openai';

function stubLocalAdapter(adapter: OllamaEmbedAdapter | LmStudioEmbedAdapter, response: unknown): void {
  adapter.prepare_embed_input = vi.fn(async (input: string) => input);
  adapter.count_tokens = vi.fn(async () => 1);
  adapter.request = vi.fn(async () => response);
}

describe('embed_api_batch auth gating', () => {
  it('still requires an API key for OpenAI adapters', async () => {
    const adapter = new OpenAIEmbedAdapter({
      adapter: 'openai',
      model_key: 'text-embedding-3-small',
      dims: 1536,
      models: OPENAI_EMBED_MODELS,
      settings: {},
    });

    await expect(embed_api_batch(adapter, [{ embed_input: 'hello' }])).rejects.toThrow('API key not set');
  });

  it('allows Ollama adapters to embed without an API key', async () => {
    const adapter = new OllamaEmbedAdapter({
      adapter: 'ollama',
      model_key: 'nomic-embed-text',
      dims: 768,
      models: {},
      settings: {},
    });
    stubLocalAdapter(adapter, { embeddings: [[1, 2, 3]], prompt_eval_count: 3 });

    await expect(embed_api_batch(adapter, [{ embed_input: 'hello' }])).resolves.toEqual([
      { embed_input: 'hello', vec: [1, 2, 3], tokens: 3 },
    ]);
  });

  it('allows LM Studio adapters to embed without an API key', async () => {
    const adapter = new LmStudioEmbedAdapter({
      adapter: 'lm_studio',
      model_key: 'text-embedding',
      dims: 768,
      models: {},
      settings: {},
    });
    stubLocalAdapter(adapter, { data: [{ embedding: [4, 5] }] });

    await expect(embed_api_batch(adapter, [{ embed_input: 'hello' }])).resolves.toEqual([
      { embed_input: 'hello', vec: [4, 5], tokens: 0 },
    ]);
  });

  it('omits authorization headers when a local adapter has no API key', () => {
    const adapter = new LmStudioEmbedAdapter({
      adapter: 'lm_studio',
      model_key: 'text-embedding',
      dims: 768,
      models: {},
      settings: {},
    });
    const requestAdapter = new adapter.req_adapter(adapter, ['hello']);
    const request = requestAdapter.to_platform();

    expect(request.headers).toEqual({ 'Content-Type': 'application/json' });
  });
});
