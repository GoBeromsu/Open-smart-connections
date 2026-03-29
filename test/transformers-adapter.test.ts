/**
 * @file transformers-adapter.test.ts
 * @description Regression tests for iframe request timeout and fatal error handling
 */

import { describe, expect, it, vi } from 'vitest';
import { TransformersEmbedAdapter, TRANSFORMERS_EMBED_MODELS } from '../src/ui/embed-adapters/transformers';

function createAdapter(timeoutMs: number): TransformersEmbedAdapter {
  return new TransformersEmbedAdapter({
    adapter: 'transformers',
    model_key: 'TaylorAI/bge-micro-v2',
    dims: 384,
    models: TRANSFORMERS_EMBED_MODELS,
    settings: { request_timeout_ms: timeoutMs },
  });
}

describe('TransformersEmbedAdapter', () => {
  it('lazy-loads the transformers model on first count_tokens call', async () => {
    const adapter = createAdapter(1000) as any;
    const loadSpy = vi.spyOn(adapter, 'load').mockImplementation(async () => {
      adapter.loaded = true;
    });
    vi.spyOn(adapter, 'send_message').mockResolvedValue({ tokens: 7 });

    const result = await adapter.count_tokens('hello');

    expect(result).toBe(7);
    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(adapter.send_message).toHaveBeenCalledWith('count_tokens', 'hello');
  });

  it('lazy-loads the transformers model on first embed_batch call', async () => {
    const adapter = createAdapter(1000) as any;
    const loadSpy = vi.spyOn(adapter, 'load').mockImplementation(async () => {
      adapter.loaded = true;
    });
    vi.spyOn(adapter, 'send_message').mockResolvedValue([{ vec: [0.1, 0.2], tokens: 5 }]);

    const result = await adapter.embed_batch([{ embed_input: 'hello', key: 'a.md', index: 0 }]);

    expect(loadSpy).toHaveBeenCalledTimes(1);
    expect(adapter.send_message).toHaveBeenCalledWith('embed_batch', {
      inputs: [{ embed_input: 'hello', key: 'a.md', index: 0 }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.vec).toEqual([0.1, 0.2]);
  });

  it('rejects load requests that do not receive iframe responses', async () => {
    const adapter = createAdapter(10) as any;
    const removeSpy = vi.fn();
    const postMessageSpy = vi.fn();
    adapter.iframe = {
      contentWindow: { postMessage: postMessageSpy },
      remove: removeSpy,
    };

    const pending = adapter.send_message('load', { model_key: 'TaylorAI/bge-micro-v2' });
    await expect(pending).rejects.toThrow(/Timed out waiting for iframe response|disposed/i);
    expect(removeSpy).toHaveBeenCalled();
    expect(adapter.iframe).toBeNull();
  });

  it('rejects pending requests when iframe reports a fatal error', async () => {
    const adapter = createAdapter(1000) as any;
    const removeSpy = vi.fn();
    const postMessageSpy = vi.fn();
    adapter.iframe = {
      contentWindow: { postMessage: postMessageSpy },
      remove: removeSpy,
    };

    const pending = adapter.send_message('embed_batch', { inputs: [{ embed_input: 'hello' }] });
    const requestId = adapter.message_id - 1;
    adapter._handle_message({
      data: {
        iframe_id: adapter.iframe_id,
        type: 'fatal',
        id: requestId,
        error: 'fatal-test',
      },
    });

    await expect(pending).rejects.toThrow(/Transformers iframe fatal error/);
    expect(removeSpy).toHaveBeenCalled();
    expect(adapter.iframe).toBeNull();
  });
});
