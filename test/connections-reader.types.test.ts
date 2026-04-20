import { describe, it, expectTypeOf } from 'vitest';
import type { ConnectionsReader } from '../src/types/connections-reader';

describe('ConnectionsReader port', () => {
  it('exposes read-only methods and no mutators', () => {
    expectTypeOf<ConnectionsReader['isReady']>().toEqualTypeOf<() => boolean>();
    expectTypeOf<ConnectionsReader['hasPendingReImport']>().toEqualTypeOf<(path: string) => boolean>();
    expectTypeOf<ConnectionsReader['ensureBlocksForSource']>().toEqualTypeOf<(path: string) => Promise<readonly import('../src/types/obsidian-shims').EmbeddingBlockLike[]>>();
    expectTypeOf<ConnectionsReader['getConnectionsForSource']>().toEqualTypeOf<(path: string, limit?: number) => Promise<readonly import('../src/types/entities').ConnectionResult[]>>();
    // @ts-expect-error mutators must not exist on the reader
    type NoMutator = ConnectionsReader['importSourceBlocks'];
  });
});
