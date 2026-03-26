/**
 * @file node-sqlite-data-adapter.test.ts
 * @description Phase 2 tests: NodeSqliteDataAdapter full lifecycle, vector roundtrip,
 * memory safety (1000 × 4096d), WAL mode, graceful close, schema, and cosine query.
 *
 * Uses real node:sqlite with a temp file — no mocks for the DB layer.
 * Verification queries bypass the Vitest alias via createRequire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { rmSync } from 'fs';
import { randomUUID } from 'crypto';

// node:sqlite requires Node 23+. Skip this entire suite on older runtimes (e.g. CI with Node 20).
let hasNodeSqlite = false;
let RealDatabaseSync: typeof import('node:sqlite').DatabaseSync;
try {
	({ DatabaseSync: RealDatabaseSync } = await import('node:sqlite'));
	hasNodeSqlite = true;
} catch {
	// node:sqlite not available
}
import {
  NodeSqliteDataAdapter,
  closeNodeSqliteDatabases,
} from '../src/domain/entities/node-sqlite-data-adapter';
import type { EntityData } from '../src/types/entities';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCollection(overrides: Record<string, any> = {}): any {
  const entities: any[] = [];
  const col = {
    embed_model_key: 'test-model',
    embed_model_dims: 0,
    consume_deleted_keys: vi.fn((): string[] => []),
    restore_deleted_keys: vi.fn(),
    create_or_update: vi.fn((data: any) => {
      const entity = {
        key: data.path,
        data,
        _queue_save: false,
        _queue_embed: true,
        is_unembedded: true,
      };
      entities.push(entity);
      return entity;
    }),
    get save_queue() {
      return entities.filter((e) => e._queue_save);
    },
    ...overrides,
  };
  // Expose internal list so tests can pre-queue entities for save()
  (col as any)._entities = entities;
  return col;
}

function makeEntity(path: string, vec: number[] | null = null, hash = `h-${path}`): any {
  const embeddings: Record<string, any> = {};
  const embeddingMeta: Record<string, any> = {};

  if (vec !== null) {
    embeddings['test-model'] = { vec, tokens: 10 };
    // hash must equal last_read.hash so query WHERE clause matches
    embeddingMeta['test-model'] = { hash, dims: vec.length, updated_at: 1000 };
  }

  return {
    key: path,
    data: {
      path,
      embeddings,
      embedding_meta: embeddingMeta,
      last_read: { hash, size: 100, mtime: 1000 },
    } as EntityData,
    _queue_save: true,
    _remove_all_embeddings: false,
    embed_model_key: 'test-model',
    validate_save: () => true,
  };
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe.skipIf(!hasNodeSqlite)('NodeSqliteDataAdapter', () => {
  let tmpDir: string;
  let dbPath: string;
  let collection: ReturnType<typeof makeCollection>;
  let adapter: NodeSqliteDataAdapter<any>;

  beforeEach(() => {
    tmpDir = join(tmpdir(), `nsq-test-${randomUUID()}`);
    dbPath = join(tmpDir, '.obsidian', 'plugins', 'test-plugin', 'test-plugin.db');
    collection = makeCollection();
    adapter = new NodeSqliteDataAdapter(collection, 'smart_blocks', 'test-ns');
    adapter.initVaultContext({ getBasePath: () => tmpDir }, '.obsidian', 'test-plugin');
  });

  afterEach(() => {
    closeNodeSqliteDatabases();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // ── Schema matches sql.js ─────────────────────────────────────────────────

  it('creates entities and entity_embeddings tables (matches sql.js schema)', () => {
    const db = new RealDatabaseSync(dbPath, { readOnly: true });
    const tables = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as any[]).map((r) => r.name);
    db.close();

    expect(tables).toContain('entities');
    expect(tables).toContain('entity_embeddings');
  });

  it('entities table has all required columns', () => {
    const db = new RealDatabaseSync(dbPath, { readOnly: true });
    const cols = (db.prepare('PRAGMA table_info(entities)').all() as any[]).map((r) => r.name);
    db.close();

    expect(cols).toEqual(expect.arrayContaining([
      'entity_key', 'entity_type', 'path', 'source_path',
      'last_read_hash', 'last_read_size', 'last_read_mtime', 'text_len', 'extra',
    ]));
  });

  it('entity_embeddings table has all required columns', () => {
    const db = new RealDatabaseSync(dbPath, { readOnly: true });
    const cols = (db.prepare('PRAGMA table_info(entity_embeddings)').all() as any[]).map((r) => r.name);
    db.close();

    expect(cols).toEqual(expect.arrayContaining([
      'entity_key', 'model_key', 'vec', 'tokens', 'embed_hash', 'dims', 'updated_at',
    ]));
  });

  // ── WAL mode ──────────────────────────────────────────────────────────────

  it('enables WAL journal mode on open', () => {
    const probe = new RealDatabaseSync(dbPath, { readOnly: true });
    const row = probe.prepare('PRAGMA journal_mode').get() as any;
    probe.close();

    expect(row.journal_mode).toBe('wal');
  });

  // ── CRUD lifecycle ────────────────────────────────────────────────────────

  it('save_batch persists entity; load() on a fresh adapter restores it', async () => {
    const entity = makeEntity('note.md', [0.1, 0.2, 0.3, 0.4]);
    await adapter.save_batch([entity]);
    expect(entity._queue_save).toBe(false);

    // Reopen with a fresh adapter on the same db file
    closeNodeSqliteDatabases();
    const collection2 = makeCollection();
    const adapter2 = new NodeSqliteDataAdapter(collection2, 'smart_blocks', 'test-ns-2');
    adapter2.initVaultContext({ getBasePath: () => tmpDir }, '.obsidian', 'test-plugin');

    await adapter2.load();

    expect(collection2.create_or_update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'note.md' }),
    );
  });

  it('save() flushes collection.save_queue to disk', async () => {
    const entity = makeEntity('queued.md', [1.0, 0.0, 0.0, 0.0]);
    (collection as any)._entities.push(entity);

    await adapter.save();

    expect(entity._queue_save).toBe(false);
    const db = new RealDatabaseSync(dbPath, { readOnly: true });
    const row = db.prepare('SELECT entity_key FROM entities WHERE entity_key = ?').get('queued.md');
    db.close();
    expect(row).toBeTruthy();
  });

  it('deleted keys are removed from disk on save_batch', async () => {
    await adapter.save_batch([makeEntity('to-delete.md', [0.5, 0.5, 0.5, 0.5])]);

    await adapter.save_batch([], ['to-delete.md']);

    const db = new RealDatabaseSync(dbPath, { readOnly: true });
    const entityRow = db.prepare('SELECT entity_key FROM entities WHERE entity_key = ?').get('to-delete.md');
    const embedRow = db.prepare('SELECT entity_key FROM entity_embeddings WHERE entity_key = ?').get('to-delete.md');
    db.close();

    expect(entityRow).toBeUndefined();
    expect(embedRow).toBeUndefined();
  });

  it('throws on use after closeNodeSqliteDatabases()', async () => {
    closeNodeSqliteDatabases();
    const entity = makeEntity('x.md', [0.1, 0.2, 0.3, 0.4]);
    await expect(adapter.save_batch([entity])).rejects.toThrow(/not initialized|database is not open/i);
  });

  // ── Vector roundtrip ──────────────────────────────────────────────────────

  it('stores and retrieves 4096-dim vector with full float32 precision', async () => {
    const vec = Array.from({ length: 4096 }, (_, i) => (i + 1) / 4097);
    await adapter.save_batch([makeEntity('large.md', vec)]);

    const result = await adapter.load_entity_vector('large.md', 'test-model');

    expect(result.vec).not.toBeNull();
    expect(result.vec!.length).toBe(4096);
    for (let i = 0; i < 4096; i++) {
      expect(result.vec![i]).toBeCloseTo(vec[i], 5);
    }
  });

  it('returns null vec for entity with no embedding', async () => {
    await adapter.save_batch([makeEntity('no-vec.md', null)]);
    const result = await adapter.load_entity_vector('no-vec.md', 'test-model');
    expect(result.vec).toBeNull();
  });

  // ── No OOM for 1000 × 4096d ───────────────────────────────────────────────

  it('saves 1000 entities × 4096d without RangeError or OOM', async () => {
    collection.embed_model_dims = 4096;

    const entities = Array.from({ length: 1000 }, (_, i) => {
      const vec = new Float32Array(4096);
      for (let j = 0; j < 4096; j++) {
        vec[j] = (i * 4096 + j + 1) / (1000 * 4096 + 1);
      }
      return makeEntity(`note-${i}.md`, Array.from(vec));
    });

    await expect(adapter.save_batch(entities)).resolves.toBeUndefined();

    const db = new RealDatabaseSync(dbPath, { readOnly: true });
    const { n } = db.prepare('SELECT COUNT(*) as n FROM entity_embeddings').get() as any;
    db.close();

    expect(n).toBe(1000);
  }, 30_000);

  // ── Cosine similarity query ───────────────────────────────────────────────

  it('query_nearest returns results ranked by cosine similarity', async () => {
    collection.embed_model_dims = 4;

    await adapter.save_batch([
      makeEntity('a.md', [1.0, 0.0, 0.0, 0.0]), // closest to query
      makeEntity('b.md', [0.0, 1.0, 0.0, 0.0]), // orthogonal — low score
      makeEntity('c.md', [0.9, 0.1, 0.0, 0.0]), // second closest
    ]);

    const results = await adapter.query_nearest([1.0, 0.0, 0.0, 0.0], { limit: 3 });

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].entity_key).toBe('a.md');
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
    }
  });

  it('query_nearest respects min_score filter', async () => {
    collection.embed_model_dims = 4;

    await adapter.save_batch([
      makeEntity('close.md', [1.0, 0.0, 0.0, 0.0]),
      makeEntity('far.md', [0.0, 0.0, 0.0, 1.0]),
    ]);

    const results = await adapter.query_nearest([1.0, 0.0, 0.0, 0.0], { min_score: 0.9 });
    const keys = results.map((r) => r.entity_key);

    expect(keys).toContain('close.md');
    expect(keys).not.toContain('far.md');
  });

  it('query_nearest excludes keys in filter.exclude', async () => {
    collection.embed_model_dims = 4;

    await adapter.save_batch([
      makeEntity('a.md', [1.0, 0.0, 0.0, 0.0]),
      makeEntity('b.md', [1.0, 0.0, 0.0, 0.0]),
    ]);

    const results = await adapter.query_nearest([1.0, 0.0, 0.0, 0.0], { exclude: ['a.md'] });
    expect(results.map((r) => r.entity_key)).not.toContain('a.md');
    expect(results.map((r) => r.entity_key)).toContain('b.md');
  });

  // ── Rollback on mid-batch error ───────────────────────────────────────────

  it('batch save rolls back on mid-batch error', async () => {
    // Save one valid entity first to confirm it survives the failed second batch
    await adapter.save_batch([makeEntity('existing.md', [1.0, 0.0, 0.0, 0.0])]);

    const goodEntity = makeEntity('good.md', [0.5, 0.5, 0.0, 0.0]);
    const badEntity = {
      ...makeEntity('bad.md', [0.0, 0.5, 0.5, 0.0]),
      validate_save: () => { throw new Error('forced mid-batch error'); },
    };

    await expect(adapter.save_batch([goodEntity, badEntity])).rejects.toThrow('forced mid-batch error');

    // Neither good.md nor bad.md should have been written (transaction rolled back)
    const db = new RealDatabaseSync(dbPath, { readOnly: true });
    const goodRow = db.prepare('SELECT entity_key FROM entities WHERE entity_key = ?').get('good.md');
    const badRow = db.prepare('SELECT entity_key FROM entities WHERE entity_key = ?').get('bad.md');
    const existingRow = db.prepare('SELECT entity_key FROM entities WHERE entity_key = ?').get('existing.md');
    db.close();

    expect(goodRow).toBeUndefined();
    expect(badRow).toBeUndefined();
    expect(existingRow).toBeTruthy();
  });
});
