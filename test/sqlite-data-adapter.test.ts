import { describe, it, expect, vi } from 'vitest';
import type { EntityData } from '../src/types/entities';

const initSqlJsMock = vi.fn();

vi.mock('sql.js', () => ({
  default: initSqlJsMock,
}));

type MockDbPlan = {
  throwOnRunCall?: number;
  throwError?: Error;
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
  private throwError?: Error;
  runCount = 0;
  closed = false;

  constructor(_data?: Uint8Array) {
    const plan = MockDatabase.plans.shift() ?? {};
    this.throwOnRunCall = plan.throwOnRunCall;
    this.throwError = plan.throwError;
    MockDatabase.instances.push(this);
  }

  run(_sql: string, _params?: unknown[]): void {
    this.runCount += 1;
    if (this.throwOnRunCall === this.runCount) {
      throw this.throwError ?? new Error('mock run failure');
    }
  }

  prepare(_sql: string): MockStatement {
    return new MockStatement();
  }

  exec(_sql: string): unknown[] {
    return [];
  }

  export(): Uint8Array {
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
});
