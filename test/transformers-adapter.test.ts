/**
 * @file transformers-adapter.test.ts
 * @description Regression tests for iframe request timeout and fatal error handling
 */

import { describe, expect, it, vi } from 'vitest';
import { TransformersEmbedAdapter, TRANSFORMERS_EMBED_MODELS } from '../src/shared/models/embed/adapters/transformers';

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
