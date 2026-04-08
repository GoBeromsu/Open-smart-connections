import { describe, expect, it } from 'vitest';

import { parseEmbedRuntimeState } from '../src/types/embed-runtime';

describe('parseEmbedRuntimeState', () => {
  it('distinguishes model-unavailable from backfill-degraded states', () => {
    const modelUnavailable = parseEmbedRuntimeState({
      phase: 'error',
      modelFingerprint: null,
      lastError: 'failed to initialize model',
    });
    expect(modelUnavailable.model.kind).toBe('unavailable');
    expect(modelUnavailable.serving.kind).toBe('unavailable');

    const degraded = parseEmbedRuntimeState({
      phase: 'error',
      modelFingerprint: 'upstage:embedding-passage:4096',
      lastError: 'Array buffer allocation failed',
    });
    expect(degraded.model.kind).toBe('ready');
    expect(degraded.backfill.kind).toBe('failed');
    expect(degraded.serving.kind).toBe('degraded');
  });

  it('treats ready fingerprint + idle phase as serving-ready', () => {
    const runtime = parseEmbedRuntimeState({
      phase: 'idle',
      modelFingerprint: 'openai:text-embedding-3-small:1536',
      lastError: null,
    });

    expect(runtime.model.kind).toBe('ready');
    expect(runtime.backfill.kind).toBe('idle');
    expect(runtime.serving.kind).toBe('ready');
  });
});
