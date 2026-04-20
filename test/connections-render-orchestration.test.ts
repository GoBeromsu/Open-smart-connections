import { describe, expect, it } from 'vitest';
import { ConnectionsResultCache } from '../src/domain/connections/result-cache';
import { decideRender } from '../src/domain/connections/render-orchestration';

describe('decideRender', () => {
  it('returns compute_fresh when there is no exact cache hit', () => {
    const cache = new ConnectionsResultCache();

    expect(decideRender({ path: 'note.md', fingerprint: 'fp-1', kernelPhase: 'idle' }, cache)).toEqual({ kind: 'compute_fresh' });
  });

  it('returns serve_cached when there is an exact cache hit and the kernel is idle', () => {
    const cache = new ConnectionsResultCache();
    const results = [{ item: { key: 'other.md#A' }, score: 0.9 }] as const;
    cache.set('note.md', 'fp-1', results);

    expect(decideRender({ path: 'note.md', fingerprint: 'fp-1', kernelPhase: 'idle' }, cache)).toEqual({ kind: 'serve_cached', results });
  });

  it('returns revalidate_in_background when there is an exact cache hit and the kernel is running', () => {
    const cache = new ConnectionsResultCache();
    const results = [{ item: { key: 'other.md#A' }, score: 0.9 }] as const;
    cache.set('note.md', 'fp-1', results);

    expect(decideRender({ path: 'note.md', fingerprint: 'fp-1', kernelPhase: 'running' }, cache)).toEqual({ kind: 'revalidate_in_background', staleResults: results });
  });
});
