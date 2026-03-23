/**
 * @file model-key-remap.test.ts
 * @description Integration test for upsertEmbedding write-asymmetry fix.
 *
 * Root cause: upsertEmbedding previously returned early when vec=[] (lazy-loaded),
 * which meant embed_hash in entity_embeddings never got synced after a save.
 * This test verifies that is_unembedded stays false after a save-while-lazy cycle.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { readFileSync } from 'fs';
import type { EntityData } from '../src/types/entities';
import { EmbeddingEntity } from '../src/domain/entities/EmbeddingEntity';

const require = createRequire(import.meta.url);
const wasmBinary = new Uint8Array(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm')));

function createVaultAdapter() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    readBinary: vi.fn(async (path: string) => {
      if (path.endsWith('sql-wasm.wasm')) return wasmBinary;
      const file = files.get(path);
      if (!file) throw new Error(`missing ${path}`);
      return file;
    }),
    exists: vi.fn(async (path: string) => {
      if (path.endsWith('sql-wasm.wasm')) return true;
      return files.has(path);
    }),
    writeBinary: vi.fn(async (path: string, data: Uint8Array | Buffer) => {
      files.set(path, data instanceof Uint8Array ? data : new Uint8Array(data));
    }),
  };
}

function makeFullEntity(path: string, vec: number[]) {
  return {
    key: path,
    data: {
      path,
      embeddings: { 'test-model': { vec, tokens: vec.length } },
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
    get save_queue() { return entities.filter(e => e._queue_save); },
    consume_deleted_keys(): string[] {
      const keys = Array.from(deleted);
      deleted.clear();
      return keys;
    },
    restore_deleted_keys(keys: string[]) { keys.forEach(k => deleted.add(k)); },
    create_or_update: vi.fn(),
  } as any;
}

/** Loading collection that creates real EmbeddingEntity instances so is_unembedded is computed correctly. */
function createRealEntityCollection(modelKey: string) {
  const all: EmbeddingEntity<any>[] = [];
  const byKey = new Map<string, EmbeddingEntity<any>>();

  const coll: any = {
    embed_model_key: modelKey,
    embed_model_dims: undefined as number | undefined,
    all,
    settings: { min_chars: 0 },
    get save_queue() { return all.filter(e => (e as any)._queue_save); },
    consume_deleted_keys(): string[] { return []; },
    restore_deleted_keys(): void {},
    delete: () => {},
    create_or_update(data: Partial<EntityData>) {
      const key = String(data.path ?? '');
      const existing = byKey.get(key);
      if (existing) {
        Object.assign(existing.data, data);
        return existing;
      }
      const entity = new EmbeddingEntity(coll, data);
      all.push(entity);
      byKey.set(key, entity);
      return entity;
    },
  };
  return coll;
}

afterEach(async () => {
  const { closeSqliteDatabases } = await import('../src/domain/entities/sqlite-data-adapter');
  await closeSqliteDatabases();
});

describe('upsertEmbedding write-asymmetry fix', () => {
  it('is_unembedded stays false after save-with-lazy-vec cycle', async () => {
    const { SqliteDataAdapter, closeSqliteDatabases } = await import('../src/domain/entities/sqlite-data-adapter');
    const vaultAdapter = createVaultAdapter();
    const ns = 'open-connections:/tmp/test-lazy-vec:.obsidian/plugins/open-connections/.smart-env';

    // ── Step 1: Save entity with full embedding ──────────────────────────
    const firstColl = createSavingCollection([makeFullEntity('note-a.md#h1', [1, 0])]);
    const firstAdapter = new SqliteDataAdapter(firstColl, 'smart_blocks', ns);
    firstAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
    await firstAdapter.save();
    await closeSqliteDatabases();

    // ── Step 2: Reload (vec becomes [] — lazy-loaded) ────────────────────
    const secondColl = createRealEntityCollection('test-model');
    const secondAdapter = new SqliteDataAdapter(secondColl, 'smart_blocks', ns);
    secondAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
    await secondAdapter.load();

    expect(secondColl.all).toHaveLength(1);
    const lazyEntity = secondColl.all[0];
    expect(lazyEntity.vec).toBeNull(); // vec is lazy (not loaded into memory)
    expect(lazyEntity.is_unembedded).toBe(false); // sanity: should already be embedded

    // ── Step 3: Save while vec is lazy (simulates autosave / file-watcher) ──
    (lazyEntity as any)._queue_save = true;
    await secondAdapter.save();
    await closeSqliteDatabases();

    // ── Step 4: Reload and verify is_unembedded is still false ───────────
    const thirdColl = createRealEntityCollection('test-model');
    const thirdAdapter = new SqliteDataAdapter(thirdColl, 'smart_blocks', ns);
    thirdAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
    await thirdAdapter.load();

    expect(thirdColl.all).toHaveLength(1);
    expect(thirdColl.all[0].is_unembedded).toBe(false);
  });
});
