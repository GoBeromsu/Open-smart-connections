import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import type { EntityData } from '../src/types/entities';

const require = createRequire(import.meta.url);
const wasmBinary = new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')));

function createVaultAdapter() {
  const files = new Map<string, Uint8Array>();

  return {
    files,
    readBinary: vi.fn(async (path: string) => {
      if (path.endsWith('sql-wasm.wasm')) {
        return wasmBinary;
      }
      const file = files.get(path);
      if (!file) {
        throw new Error(`missing ${path}`);
      }
      return file;
    }),
    exists: vi.fn(async (path: string) => {
      if (path.endsWith('sql-wasm.wasm')) {
        return true;
      }
      return files.has(path);
    }),
    writeBinary: vi.fn(async (path: string, data: Uint8Array | Buffer) => {
      files.set(path, data instanceof Uint8Array ? data : new Uint8Array(data));
    }),
  };
}

function makeEntity(path: string, vec: number[]) {
  return {
    key: path,
    data: {
      path,
      embeddings: {
        'test-model': { vec, tokens: vec.length },
      },
      last_read: { hash: `hash:${path}`, size: vec.length * 4, mtime: 123 },
      embedding_meta: {
        'test-model': { hash: `hash:${path}`, dims: vec.length, updated_at: 456 },
      },
    } as EntityData,
    _queue_save: true,
    _queue_embed: false,
    _remove_all_embeddings: false,
    embed_model_key: 'test-model',
    is_unembedded: false,
    validate_save: () => true,
  };
}

function createSavingCollection(entities: any[]) {
  const deleted = new Set<string>();
  return {
    embed_model_key: 'test-model',
    embed_model_dims: 2,
    all: entities,
    get save_queue() {
      return entities.filter(entity => entity._queue_save);
    },
    consume_deleted_keys(): string[] {
      const keys = Array.from(deleted);
      deleted.clear();
      return keys;
    },
    restore_deleted_keys(keys: string[]): void {
      keys.forEach((key) => deleted.add(key));
    },
    create_or_update: vi.fn(),
  } as any;
}

function createLoadingCollection() {
  const all: any[] = [];
  const byKey = new Map<string, any>();

  return {
    embed_model_key: 'test-model',
    embed_model_dims: 2,
    all,
    get save_queue() {
      return all.filter(entity => entity._queue_save);
    },
    consume_deleted_keys(): string[] {
      return [];
    },
    restore_deleted_keys(): void {},
    create_or_update(data: Partial<EntityData>) {
      const key = String(data.path ?? '');
      const existing = byKey.get(key);
      if (existing) {
        existing.data = data as EntityData;
        return existing;
      }

      const entity = {
        key,
        data: data as EntityData,
        _queue_save: false,
        _queue_embed: false,
        _remove_all_embeddings: false,
        embed_model_key: 'test-model',
        is_unembedded: false,
        validate_save: () => true,
      };
      all.push(entity);
      byKey.set(key, entity);
      return entity;
    },
  } as any;
}

afterEach(async () => {
  const { closeSqliteDatabases } = await import('../src/domain/entities/sqlite-data-adapter');
  await closeSqliteDatabases();
});

describe('SqliteDataAdapter real sql.js lifecycle', () => {
  it('round-trips save, close, reopen, load, load_entity_vector, and query_nearest', async () => {
    const { SqliteDataAdapter, closeSqliteDatabases } = await import('../src/domain/entities/sqlite-data-adapter');
    const vaultAdapter = createVaultAdapter();
    const storageNamespace = 'open-connections:/tmp/test-real:.obsidian/plugins/open-connections/.smart-env';

    const firstCollection = createSavingCollection([
      makeEntity('note-a.md#h1', [1, 0]),
      makeEntity('note-b.md#h1', [0, 1]),
    ]);
    const firstAdapter = new SqliteDataAdapter(firstCollection, 'smart_blocks', storageNamespace);
    firstAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await firstAdapter.save();
    expect(vaultAdapter.writeBinary).not.toHaveBeenCalled();

    await closeSqliteDatabases();
    expect(vaultAdapter.writeBinary).toHaveBeenCalled();

    const secondCollection = createLoadingCollection();
    const secondAdapter = new SqliteDataAdapter(secondCollection, 'smart_blocks', storageNamespace);
    secondAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await secondAdapter.load();

    expect(secondCollection.all.map((entity: any) => entity.key).sort()).toEqual([
      'note-a.md#h1',
      'note-b.md#h1',
    ]);

    const loaded = await secondAdapter.load_entity_vector('note-a.md#h1', 'test-model');
    expect(loaded.vec).toEqual([1, 0]);
    expect(loaded.tokens).toBe(2);
    expect(loaded.meta?.hash).toBe('hash:note-a.md#h1');

    const nearest = await secondAdapter.query_nearest([1, 0], { limit: 1 }, 1);
    expect(nearest).toHaveLength(1);
    expect(nearest[0].entity_key).toBe('note-a.md#h1');
    expect(nearest[0].score).toBeGreaterThan(0.99);
  });

  it('does not resurrect a deleted persisted database during close', async () => {
    const { SqliteDataAdapter, closeSqliteDatabases } = await import('../src/domain/entities/sqlite-data-adapter');
    const vaultAdapter = createVaultAdapter();
    const storageNamespace = 'open-connections:/tmp/test-real-delete:.obsidian/plugins/open-connections/.smart-env';
    const dbPath = '.obsidian/plugins/open-connections/open-connections.db';

    const firstCollection = createSavingCollection([
      makeEntity('note-a.md#h1', [1, 0]),
    ]);
    const firstAdapter = new SqliteDataAdapter(firstCollection, 'smart_blocks', storageNamespace);
    firstAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');

    await firstAdapter.save();
    await closeSqliteDatabases();

    expect(vaultAdapter.files.has(dbPath)).toBe(true);

    const secondCollection = createLoadingCollection();
    const secondAdapter = new SqliteDataAdapter(secondCollection, 'smart_blocks', storageNamespace);
    secondAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
    await secondAdapter.load();

    const writesBeforeDelete = vaultAdapter.writeBinary.mock.calls.length;
    vaultAdapter.files.delete(dbPath);

    await closeSqliteDatabases();

    expect(vaultAdapter.writeBinary).toHaveBeenCalledTimes(writesBeforeDelete);
    expect(vaultAdapter.files.has(dbPath)).toBe(false);
  });
});
