import { afterEach, describe, expect, it, vi } from 'vitest';

const initSqlJs = vi.fn();
let dbConstructCount = 0;

class MockDatabase {
  filename: string;
  db: number;
  fb = {};
  Sa = {};

  constructor(_data?: Uint8Array) {
    dbConstructCount += 1;
    this.db = dbConstructCount;
    this.filename = `mock-${dbConstructCount}`;
  }

  run(_sql: string, _params?: unknown[]): void {}

  export(): Uint8Array {
    return new Uint8Array([1, 2, 3]);
  }

  close(): void {}
}

vi.mock('sql.js', () => ({
  default: initSqlJs,
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeEntity(path: string) {
  return {
    key: path,
    data: {
      path,
      embeddings: {},
    },
    _queue_save: true,
    validate_save: () => true,
  };
}

afterEach(async () => {
  try {
    const mod = await import('../src/domain/entities/sqlite-data-adapter');
    await mod.closeSqliteDatabases();
  } catch {
    // Module may not be loaded in a given test.
  }
  vi.clearAllMocks();
  vi.resetModules();
  dbConstructCount = 0;
  initSqlJs.mockReset();
});

describe('SQLite adapter lifecycle', () => {
  it('detaches singleton DB state before awaiting persistence during close', async () => {
    initSqlJs.mockResolvedValue({ Database: MockDatabase } as any);

    let writeCount = 0;
    const firstWrite = deferred<void>();
    const vaultAdapter = {
      readBinary: vi.fn(async () => {
        throw new Error('missing');
      }),
      writeBinary: vi.fn(async () => {
        writeCount += 1;
        if (writeCount === 1) {
          return firstWrite.promise;
        }
      }),
    };

    const { SqliteDataAdapter, closeSqliteDatabases } = await import('../src/domain/entities/sqlite-data-adapter');
    const storageNamespace = 'open-connections:/tmp/ataraxia:.obsidian/plugins/open-connections/.smart-env';

    const createAdapter = () => {
      const collection = {
        embed_model_key: 'test-model',
        save_queue: [],
        consume_deleted_keys: () => [],
        create_or_update: vi.fn(),
      } as any;
      const adapter = new SqliteDataAdapter(collection, 'smart_sources', storageNamespace);
      adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
      return adapter;
    };

    const firstAdapter = createAdapter();
    await firstAdapter.save_batch([makeEntity('first-note.md') as any]);
    expect(dbConstructCount).toBe(1);

    const closePromise = closeSqliteDatabases();

    const secondAdapter = createAdapter();
    await secondAdapter.save_batch([makeEntity('second-note.md') as any]);

    expect(dbConstructCount).toBe(2);

    firstWrite.resolve();
    await closePromise;
  });
});
