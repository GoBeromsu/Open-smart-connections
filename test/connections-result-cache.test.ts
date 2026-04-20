import { describe, expect, it } from 'vitest';
import { ConnectionsResultCache } from '../src/domain/connections/result-cache';

describe('ConnectionsResultCache', () => {
  it('returns null when no entry exists for the path', () => {
    const cache = new ConnectionsResultCache();

    expect(cache.get('note.md', 'fp-1')).toBeNull();
  });

  it('returns cached results only for an exact path + fingerprint match', () => {
    const cache = new ConnectionsResultCache();
    const results = [{ item: { key: 'other.md#A' }, score: 0.9 }] as const;

    cache.set('note.md', 'fp-1', results);

    expect(cache.get('note.md', 'fp-1')).toEqual(results);
    expect(cache.get('note.md', 'fp-2')).toBeNull();
    expect(cache.get('other.md', 'fp-1')).toBeNull();
  });


  it('replaces an existing path entry instead of keeping stale results', () => {
    const cache = new ConnectionsResultCache();
    const initial = [{ item: { key: 'old.md#A' }, score: 0.4 }];
    const updated = [{ item: { key: 'new.md#B' }, score: 0.95 }];

    cache.set('note.md', 'fp-1', initial);
    cache.set('note.md', 'fp-1', updated);

    expect(cache.get('note.md', 'fp-1')).toEqual(updated);
  });

  it('invalidates only the specified path', () => {
    const cache = new ConnectionsResultCache();
    const noteResults = [{ item: { key: 'other.md#A' }, score: 0.9 }];
    const otherResults = [{ item: { key: 'third.md#B' }, score: 0.8 }];

    cache.set('note.md', 'fp-1', noteResults);
    cache.set('other.md', 'fp-1', otherResults);

    cache.invalidate('note.md');

    expect(cache.get('note.md', 'fp-1')).toBeNull();
    expect(cache.get('other.md', 'fp-1')).toEqual(otherResults);
  });

  it('invalidates all cached paths', () => {
    const cache = new ConnectionsResultCache();

    cache.set('note.md', 'fp-1', [{ item: { key: 'other.md#A' }, score: 0.9 }]);
    cache.set('other.md', 'fp-2', [{ item: { key: 'third.md#B' }, score: 0.8 }]);

    cache.invalidateAll();

    expect(cache.get('note.md', 'fp-1')).toBeNull();
    expect(cache.get('other.md', 'fp-2')).toBeNull();
  });

  it('evicts the least-recently-used entry once the cache exceeds its max size', () => {
    const cache = new ConnectionsResultCache();

    for (let index = 0; index < 64; index += 1) {
      cache.set(`note-${index}.md`, 'fp-1', [{ item: { key: `result-${index}` }, score: index }]);
    }

    cache.set('overflow.md', 'fp-1', [{ item: { key: 'result-overflow' }, score: 999 }]);

    expect(cache.get('note-0.md', 'fp-1')).toBeNull();
    expect(cache.get('overflow.md', 'fp-1')).toEqual([{ item: { key: 'result-overflow' }, score: 999 }]);
  });

  it('treats a cache hit as recent for LRU eviction', () => {
    const cache = new ConnectionsResultCache();

    for (let index = 0; index < 64; index += 1) {
      cache.set(`note-${index}.md`, 'fp-1', [{ item: { key: `result-${index}` }, score: index }]);
    }

    expect(cache.get('note-0.md', 'fp-1')).toEqual([{ item: { key: 'result-0' }, score: 0 }]);

    cache.set('overflow.md', 'fp-1', [{ item: { key: 'result-overflow' }, score: 999 }]);

    expect(cache.get('note-0.md', 'fp-1')).toEqual([{ item: { key: 'result-0' }, score: 0 }]);
    expect(cache.get('note-1.md', 'fp-1')).toBeNull();
  });
});
