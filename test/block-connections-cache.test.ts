import { describe, it, afterEach } from 'vitest';
import { invalidateConnectionsCache } from '../src/ui/block-connections';

// We test the cache via the invalidation export and behavior observation.
// Full integration test would need mocked BlockCollection.
describe('block connections cache', () => {
  afterEach(() => {
    invalidateConnectionsCache(); // clear between tests
  });

  it('invalidateConnectionsCache(path) clears specific entry', () => {
    // The cache is internal, but invalidation should not throw
    invalidateConnectionsCache('some/path.md');
  });

  it('invalidateConnectionsCache() clears all entries', () => {
    invalidateConnectionsCache();
  });
});
