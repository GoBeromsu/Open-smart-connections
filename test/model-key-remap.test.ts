/**
 * @file model-key-remap.test.ts
 * @description Integration test for upsertEmbedding write-asymmetry fix.
 *
 * Root cause: upsertEmbedding previously returned early when vec=[] (lazy-loaded),
 * which meant embed_hash in entity_embeddings never got synced after a save.
 * This test verifies that is_unembedded stays false after a save-while-lazy cycle.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';
import { randomUUID } from 'crypto';
import type { EntityData } from '../src/types/entities';
import { EmbeddingEntity } from '../src/domain/entities/EmbeddingEntity';

// node:sqlite requires Node 23+. Skip this entire suite on older runtimes (e.g. CI with Node 20).
let hasNodeSqlite = false;
let NodeSqliteDataAdapter: typeof import('../src/domain/entities/node-sqlite-data-adapter').NodeSqliteDataAdapter;
let closeNodeSqliteDatabases: typeof import('../src/domain/entities/node-sqlite-data-adapter').closeNodeSqliteDatabases;
try {
	await import('node:sqlite');
	({ NodeSqliteDataAdapter, closeNodeSqliteDatabases } = await import('../src/domain/entities/node-sqlite-data-adapter'));
	hasNodeSqlite = true;
} catch {
	// node:sqlite not available
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

let tmpDir: string;

afterEach(() => {
  closeNodeSqliteDatabases();
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

describe.skipIf(!hasNodeSqlite)('upsertEmbedding write-asymmetry fix', () => {
  it('is_unembedded stays false after save-with-lazy-vec cycle', async () => {
    tmpDir = join(tmpdir(), `remap-test-${randomUUID()}`);
    const vaultAdapter = { getBasePath: () => tmpDir };
    const ns = 'open-connections:/tmp/test-lazy-vec:.obsidian/plugins/open-connections/.smart-env';

    // ── Step 1: Save entity with full embedding ──────────────────────────
    const firstColl = createSavingCollection([makeFullEntity('note-a.md#h1', [1, 0])]);
    const firstAdapter = new NodeSqliteDataAdapter(firstColl, 'smart_blocks', ns);
    firstAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
    await firstAdapter.save();
    closeNodeSqliteDatabases();

    // ── Step 2: Reload (vec becomes [] — lazy-loaded) ────────────────────
    const secondColl = createRealEntityCollection('test-model');
    const secondAdapter = new NodeSqliteDataAdapter(secondColl, 'smart_blocks', ns);
    secondAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
    await secondAdapter.load();

    expect(secondColl.all).toHaveLength(1);
    const lazyEntity = secondColl.all[0];
    expect(lazyEntity.vec).toBeNull();
    expect(lazyEntity.is_unembedded).toBe(false);

    // ── Step 3: Save while vec is lazy (simulates autosave / file-watcher) ──
    (lazyEntity as any)._queue_save = true;
    await secondAdapter.save();
    closeNodeSqliteDatabases();

    // ── Step 4: Reload and verify is_unembedded is still false ───────────
    const thirdColl = createRealEntityCollection('test-model');
    const thirdAdapter = new NodeSqliteDataAdapter(thirdColl, 'smart_blocks', ns);
    thirdAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
    await thirdAdapter.load();

    expect(thirdColl.all).toHaveLength(1);
    expect(thirdColl.all[0].is_unembedded).toBe(false);
  });
});
