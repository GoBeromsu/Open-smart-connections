import { describe, expect, it } from 'vitest';
import { create_transformers_srcdoc } from '../src/ui/embed-adapters/transformers-iframe';
import { EMBED_CONNECTOR } from '../src/ui/embed-adapters/transformers-connector';

describe('transformers iframe srcdoc contract', () => {
  it('keeps sandbox-compatible wildcard messaging guarded by token/source/schema checks', () => {
    const srcdoc = create_transformers_srcdoc('frame-1', 'token-1');

    expect(srcdoc).toContain('const IFRAME_ID = "frame-1";');
    expect(srcdoc).toContain('const CHANNEL_TOKEN = "token-1";');
    expect(srcdoc).toContain('event.source !== window.parent');
    expect(srcdoc).toContain('is_trusted_parent_request(event.data)');
    expect(srcdoc).toContain("window.parent.postMessage({ ...response, channel_token: CHANNEL_TOKEN }, '*')");
  });

  it('documents the residual pinned CDN runtime and validates bridge request schema', () => {
    expect(EMBED_CONNECTOR).toContain('@huggingface/transformers@3.8.0');
    expect(EMBED_CONNECTOR).toContain('pinned and kept inside a sandboxed srcdoc iframe');
    expect(EMBED_CONNECTOR).toContain('assert_request_schema(data)');
    expect(EMBED_CONNECTOR).toContain("Unknown method");
  });
});
