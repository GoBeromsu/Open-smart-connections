import { afterEach, describe, it, expect, vi } from 'vitest';
import type { EntityData } from '../src/types/entities';

const initSqlJsMock = vi.fn();

vi.mock('sql.js', () => ({
  default: initSqlJsMock,
}));

type MockDbPlan = {
  throwOnRunCall?: number;
  throwOnPrepareCall?: number;
  throwError?: Error;
  throwOnExport?: boolean;
};

class MockStatement {
  bind(): void {}
  step(): boolean { return false; }
  getAsObject(): Record<string, unknown> { return {}; }
  free(): void {}
}

class MockDatabase {
  static instances: MockDatabase[] = [];
  static plans: MockDbPlan[] = [];

  static reset(plans: MockDbPlan[] = []): void {
    MockDatabase.instances = [];
    MockDatabase.plans = [...plans];
  }

  private throwOnRunCall?: number;
  private throwOnPrepareCall?: number;
  private throwError?: Error;
  private throwOnExport: boolean;
  runCount = 0;
  prepareCount = 0;
  closed = false;

  constructor(_data?: Uint8Array) {
    const plan = MockDatabase.plans.shift() ?? {};
    this.throwOnRunCall = plan.throwOnRunCall;
    this.throwOnPrepareCall = plan.throwOnPrepareCall;
    this.throwError = plan.throwError;
    this.throwOnExport = plan.throwOnExport ?? false;
    MockDatabase.instances.push(this);
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error('closed db');
    }
  }

  run(_sql: string, _params?: unknown[]): void {
    this.assertOpen();
    this.runCount += 1;
    if (this.throwOnRunCall === this.runCount) {
      throw this.throwError ?? new Error('mock run failure');
    }
  }

  prepare(_sql: string): MockStatement {
    this.assertOpen();
    this.prepareCount += 1;
    if (this.throwOnPrepareCall === this.prepareCount) {
      throw this.throwError ?? new Error('mock prepare failure');
    }
    return new MockStatement();
  }

  exec(_sql: string): unknown[] {
    this.assertOpen();
    return [];
  }

  export(): Uint8Array {
    this.assertOpen();
    if (this.throwOnExport) {
      throw this.throwError ?? new Error('mock export failure');
    }
    return new Uint8Array([1, 2, 3]);
  }

  close(): void {
    this.closed = true;
  }
}

function makeEntity(path: string = 'note.md') {
  return {
    key: path,
    data: {
      path,
      embeddings: {
        'test-model': { vec: [0.1, 0.2], tokens: 5 },
      },
      last_read: { hash: 'hash', size: 10, mtime: 20 },
      embedding_meta: {
        'test-model': { hash: 'hash', dims: 2, updated_at: 123 },
      },
    } as EntityData,
    _queue_save: true,
    _remove_all_embeddings: false,
    embed_model_key: 'test-model',
    validate_save: () => true,
  };
}

function createCollection(entities: any[], initialDeletedKeys: string[] = []) {
  const deleted = new Set(initialDeletedKeys);
  const collection = {
    embed_model_key: 'test-model',
    create_or_update: vi.fn(),
    get save_queue() {
      return entities.filter((entity) => entity._queue_save);
    },
    consume_deleted_keys(): string[] {
      const keys = Array.from(deleted);
      deleted.clear();
      return keys;
    },
    restore_deleted_keys(keys: string[]): void {
      keys.forEach((key) => deleted.add(key));
    },
  } as any;

  return { collection, deleted };
}

function createVaultAdapter() {
  return {
    readBinary: vi.fn(async (path: string) => {
      throw new Error(`missing ${path}`);
    }),
    writeBinary: vi.fn(async () => {}),
  };
}

async function loadAdapterModule(plans: MockDbPlan[] = []) {
  vi.resetModules();
  MockDatabase.reset(plans);
  initSqlJsMock.mockReset();
  initSqlJsMock.mockResolvedValue({ Database: MockDatabase });
  return import('../src/domain/entities/sqlite-data-adapter');
}

afterEach(() => {
  vi.useRealTimers();
});

describe('SqliteDataAdapter', () => {
  it('keeps queued saves and deleted keys after a failed transaction', async () => {
    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([
      { throwOnRunCall: 3, throwError: new Error('boom') },
    ]);

    const entity = makeEntity();
    const { collection, deleted } = createCollection([entity], ['gone.md']);
    const vaultAdapter = createVaultAdapter();
    const adapter = new SqliteDataAdapter(collection, 'smart_blocks', 'test-namespace');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await expect(adapter.save()).rejects.toThrow('boom');
    expect(entity._queue_save).toBe(true);
    expect(Array.from(deleted)).toEqual(['gone.md']);

    await closeSqliteDatabases();
  });

  it('recreates the database handle and retries once after SQLITE_MISUSE', async () => {
    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([
      {
        throwOnRunCall: 2,
        throwError: new Error('bad parameter or other API misuse'),
      },
      {},
    ]);

    const entity = makeEntity();
    const { collection } = createCollection([entity]);
    const vaultAdapter = createVaultAdapter();
    const adapter = new SqliteDataAdapter(collection, 'smart_blocks', 'test-namespace');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await expect(adapter.save()).resolves.toBeUndefined();
    expect(MockDatabase.instances).toHaveLength(2);
    expect(MockDatabase.instances[0].closed).toBe(true);
    expect(entity._queue_save).toBe(false);

    await closeSqliteDatabases();
  });

  it('recreates the database handle when autosave persistence hits SQLITE_MISUSE', async () => {
    vi.useFakeTimers();

    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([
      {
        throwOnExport: true,
        throwError: new Error('bad parameter or other API misuse'),
      },
      {},
    ]);

    const entity = makeEntity();
    const { collection } = createCollection([entity]);
    const vaultAdapter = createVaultAdapter();
    const adapter = new SqliteDataAdapter(collection, 'smart_blocks', 'test-namespace');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await adapter.save();
    expect(MockDatabase.instances).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(MockDatabase.instances).toHaveLength(2);
    expect(MockDatabase.instances[0].closed).toBe(true);

    await closeSqliteDatabases();
  });

  it('persists a fresh database on autosave before any file exists on disk', async () => {
    vi.useFakeTimers();

    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([
      {},
    ]);

    let fileExists = false;
    const vaultAdapter = {
      exists: vi.fn(async () => fileExists),
      readBinary: vi.fn(async () => {
        throw new Error('missing');
      }),
      writeBinary: vi.fn(async () => {
        fileExists = true;
      }),
    };

    const entity = makeEntity();
    const { collection } = createCollection([entity]);
    const adapter = new SqliteDataAdapter(collection, 'smart_blocks', 'fresh-autosave-namespace');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await adapter.save();
    expect(vaultAdapter.writeBinary).toHaveBeenCalledTimes(0);

    await vi.advanceTimersByTimeAsync(30_000);

    expect(vaultAdapter.writeBinary).toHaveBeenCalledTimes(1);
    expect(fileExists).toBe(true);

    await closeSqliteDatabases();
  });

  it('rebinds queued callers onto the fresh database after recreate', async () => {
    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([
      {
        throwOnRunCall: 2,
        throwError: new Error('bad parameter or other API misuse'),
      },
      {},
    ]);

    const { collection } = createCollection([]);
    const vaultAdapter = createVaultAdapter();
    const adapter = new SqliteDataAdapter(collection, 'smart_blocks', 'test-namespace');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    const first = makeEntity('first.md');
    const second = makeEntity('second.md');

    await expect(Promise.all([
      adapter.save_batch([first] as any),
      adapter.save_batch([second] as any),
    ])).resolves.toEqual([undefined, undefined]);

    expect(MockDatabase.instances).toHaveLength(2);
    expect(MockDatabase.instances[0].closed).toBe(true);
    expect(MockDatabase.instances[1].runCount).toBeGreaterThan(0);

    await closeSqliteDatabases();
  });

  it('retries load() after SQLITE_MISUSE on the read path', async () => {
    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([
      {
        throwOnPrepareCall: 1,
        throwError: new Error('bad parameter or other API misuse'),
      },
      {},
    ]);

    const { collection } = createCollection([]);
    const vaultAdapter = createVaultAdapter();
    const adapter = new SqliteDataAdapter(collection, 'smart_blocks', 'test-namespace');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await expect(adapter.load()).resolves.toBeUndefined();
    expect(MockDatabase.instances).toHaveLength(2);
    expect(MockDatabase.instances[0].closed).toBe(true);

    await closeSqliteDatabases();
  });

  it('does not resurrect a deleted database during SQLITE_MISUSE recovery', async () => {
    const misuse = new Error('bad parameter or other API misuse');
    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([
      {},
      {
        throwOnRunCall: 2,
        throwError: misuse,
      },
      {},
    ]);

    let fileExists = true;
    const vaultAdapter = {
      exists: vi.fn(async (path: string) => {
        if (path.endsWith('sql-wasm.wasm')) {
          return false;
        }
        return fileExists;
      }),
      readBinary: vi.fn(async (path: string) => {
        if (path.endsWith('sql-wasm.wasm')) {
          throw new Error('missing wasm');
        }
        if (!fileExists) {
          throw new Error('missing db');
        }
        return new Uint8Array([1, 2, 3]);
      }),
      writeBinary: vi.fn(async () => {
        fileExists = true;
      }),
    };
    const storageNamespace = 'misuse-delete-namespace';

    const primedEntity = makeEntity('primed.md');
    const { collection: primedCollection } = createCollection([primedEntity]);
    const primedAdapter = new SqliteDataAdapter(primedCollection, 'smart_blocks', storageNamespace);
    primedAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await primedAdapter.save();
    await closeSqliteDatabases();

    expect(vaultAdapter.writeBinary).toHaveBeenCalledTimes(1);
    expect(fileExists).toBe(true);

    const nextEntity = makeEntity('after-delete.md');
    const { collection: nextCollection } = createCollection([nextEntity]);
    const adapter = new SqliteDataAdapter(nextCollection, 'smart_blocks', storageNamespace);
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await adapter.load();
    fileExists = false;

    await expect(adapter.save()).resolves.toBeUndefined();

    expect(vaultAdapter.writeBinary).toHaveBeenCalledTimes(1);
    expect(fileExists).toBe(false);

    await closeSqliteDatabases();
  });

  it('retries query_nearest() after SQLITE_MISUSE on the read path', async () => {
    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([
      {
        throwOnPrepareCall: 1,
        throwError: new Error('bad parameter or other API misuse'),
      },
      {},
    ]);

    const { collection } = createCollection([]);
    collection.embed_model_dims = 2;
    const vaultAdapter = createVaultAdapter();
    const adapter = new SqliteDataAdapter(collection, 'smart_blocks', 'test-namespace');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await expect(adapter.query_nearest([0.1, 0.2])).resolves.toEqual([]);
    expect(MockDatabase.instances).toHaveLength(2);
    expect(MockDatabase.instances[0].closed).toBe(true);

    await closeSqliteDatabases();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Vector serialization roundtrip
//
// vecToBlob and blobToF32 are module-private. These spec helpers mirror the
// target implementation (Step 1.3 in the plan). Once the developer exports
// them, replace the helpers below with:
//   import { vecToBlob, blobToF32 } from '../src/domain/entities/sqlite-data-adapter';
// ─────────────────────────────────────────────────────────────────────────────

describe('vector serialization roundtrip', () => {
  function vecToBlob(vec: number[] | Float32Array): Uint8Array {
    const f32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
    return new Uint8Array(f32.buffer);
  }

  function blobToF32(blob: Uint8Array | ArrayBuffer | null): Float32Array | null {
    if (!blob) return null;
    if (blob instanceof ArrayBuffer) {
      if (blob.byteLength === 0 || blob.byteLength % 4 !== 0) return null;
      return new Float32Array(blob);
    }
    if (blob.byteLength === 0 || blob.byteLength % 4 !== 0) return null;
    // Aligned: direct view, no copy (safe for read-only cos_sim usage)
    if (blob.byteOffset % 4 === 0) {
      return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
    }
    // Misaligned: must copy to ensure 4-byte alignment
    return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
  }

  function makeVec(dims: number): number[] {
    return Array.from({ length: dims }, (_, i) => (i + 1) / (dims + 1));
  }

  it.each([256, 384, 768, 1024, 3072, 4096])(
    'preserves all float values for %d-dim vector',
    (dims) => {
      const original = makeVec(dims);
      const blob = vecToBlob(original);
      const decoded = blobToF32(blob);

      expect(decoded).not.toBeNull();
      expect(decoded!.length).toBe(dims);
      for (let i = 0; i < dims; i++) {
        expect(decoded![i]).toBeCloseTo(original[i], 5);
      }
    },
  );

  it('returns null for null input', () => {
    expect(blobToF32(null)).toBeNull();
  });

  it('returns null for empty Uint8Array', () => {
    expect(blobToF32(new Uint8Array(0))).toBeNull();
  });

  it('returns null for empty ArrayBuffer', () => {
    expect(blobToF32(new ArrayBuffer(0))).toBeNull();
  });

  it.each([1, 2, 3, 5, 6, 7])(
    'returns null for malformed blob with %d bytes (not divisible by 4)',
    (n) => {
      expect(blobToF32(new Uint8Array(n))).toBeNull();
    },
  );

  it('aligned path shares underlying buffer (no extra allocation)', () => {
    const original = makeVec(384);
    const blob = vecToBlob(original); // Float32Array.buffer is always 4-byte aligned
    expect(blob.byteOffset % 4).toBe(0);
    const decoded = blobToF32(blob)!;
    // Aligned view — shares same ArrayBuffer, no copy
    expect(decoded.buffer).toBe(blob.buffer);
  });

  it('accepts ArrayBuffer input directly', () => {
    const original = makeVec(8);
    const blob = vecToBlob(original);
    const decoded = blobToF32(blob.buffer)!;
    expect(decoded).not.toBeNull();
    expect(decoded.length).toBe(8);
    for (let i = 0; i < 8; i++) {
      expect(decoded[i]).toBeCloseTo(original[i], 5);
    }
  });

  it('handles Float32Array input (identity roundtrip)', () => {
    const f32 = new Float32Array([1.5, -2.5, 0.0, 3.14]);
    const blob = vecToBlob(f32);
    const decoded = blobToF32(blob)!;
    expect(Array.from(decoded)).toEqual(Array.from(f32));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC7: persistDbNow must pass ArrayBuffer to writeBinary — not Buffer.from()
//
// This test FAILS against current code (Buffer.from creates a Node Buffer,
// not an ArrayBuffer) and PASSES after the fix (data.buffer is ArrayBuffer).
// ─────────────────────────────────────────────────────────────────────────────

describe('persistDbNow - writeBinary receives ArrayBuffer (AC7)', () => {
  it('passes data.buffer (ArrayBuffer) to writeBinary — not a Buffer copy', async () => {
    vi.useFakeTimers();

    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([{}]);

    let fileExists = false;
    const writeBinary = vi.fn(async () => { fileExists = true; });
    const vaultAdapter = {
      exists: vi.fn(async () => fileExists),
      readBinary: vi.fn(async () => { throw new Error('missing'); }),
      writeBinary,
    };

    const entity = makeEntity();
    const { collection } = createCollection([entity]);
    const adapter = new SqliteDataAdapter(collection, 'smart_blocks', 'arraybuffer-ns');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await adapter.save();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(writeBinary).toHaveBeenCalledTimes(1);
    const [, writtenData] = (writeBinary as ReturnType<typeof vi.fn>).mock.calls[0];
    // Fix: data.buffer (ArrayBuffer) — not Buffer.from(data) (Node Buffer)
    expect(writtenData).toBeInstanceOf(ArrayBuffer);

    await closeSqliteDatabases();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AC8: dirty flag — autosave skips export when nothing changed
//
// Test A (regression): skips second autosave cycle when no writes since persist
// Test B (TDD - FAILS now): persists after new writes following initial persist
//   FAILS because executeSaveBatch doesn't set dirtySincePersist=true yet.
// ─────────────────────────────────────────────────────────────────────────────

describe('dirty flag - autosave skips export when nothing changed (AC8)', () => {
  it('skips second autosave cycle when no new writes since last persist', async () => {
    vi.useFakeTimers();

    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([{}]);

    let fileExists = false;
    const writeBinary = vi.fn(async () => { fileExists = true; });
    const vaultAdapter = {
      exists: vi.fn(async () => fileExists),
      readBinary: vi.fn(async () => { throw new Error('missing'); }),
      writeBinary,
    };

    const entity = makeEntity();
    const { collection } = createCollection([entity]);
    const adapter = new SqliteDataAdapter(collection, 'smart_blocks', 'dirty-skip-ns');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await adapter.save();
    await vi.advanceTimersByTimeAsync(30_000); // first autosave: persists (fresh db)
    expect(writeBinary).toHaveBeenCalledTimes(1);

    // No new writes — second autosave must skip (dirtySincePersist=false)
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeBinary).toHaveBeenCalledTimes(1);

    await closeSqliteDatabases();
  });

  it('persists on autosave after new writes since last persist', async () => {
    vi.useFakeTimers();

    const { SqliteDataAdapter, closeSqliteDatabases } = await loadAdapterModule([{}]);

    let fileExists = false;
    const writeBinary = vi.fn(async () => { fileExists = true; });
    const vaultAdapter = {
      exists: vi.fn(async () => fileExists),
      readBinary: vi.fn(async () => { throw new Error('missing'); }),
      writeBinary,
    };

    const entity1 = makeEntity('first.md');
    const { collection } = createCollection([entity1]);
    const adapter = new SqliteDataAdapter(collection, 'smart_blocks', 'dirty-write-ns');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    // Initial save + first autosave
    await adapter.save();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeBinary).toHaveBeenCalledTimes(1);

    // New write after first persist — must mark dirtySincePersist=true
    const entity2 = makeEntity('second.md');
    await adapter.save_batch([entity2] as any);

    // Second autosave: should persist because new data was written (FAILS until fix)
    await vi.advanceTimersByTimeAsync(30_000);
    expect(writeBinary).toHaveBeenCalledTimes(2);

    await closeSqliteDatabases();
  });
});
