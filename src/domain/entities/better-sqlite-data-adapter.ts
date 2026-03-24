/**
 * @file better-sqlite-data-adapter.ts
 * @description SQLite (better-sqlite3) data adapter for entity persistence.
 * File-backed database — no db.export(), no Buffer.from(), no OOM risk.
 * Replaces sql.js for high-dimension models (Upstage 4096d, OpenAI 3072d).
 */

import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';
import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityCollection } from './EntityCollection';
import type { EntityData, EmbeddingModelMeta, SearchFilter } from '../../types/entities';
import { cos_sim_f32 } from '../../utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function vecToBlob(vec: number[] | Float32Array): Uint8Array {
  const f32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
  return new Uint8Array(f32.buffer);
}

function blobToF32(blob: Buffer | Uint8Array | null): Float32Array | null {
  if (!blob) return null;
  if (blob.byteLength === 0 || blob.byteLength % 4 !== 0) return null;
  // Direct view when aligned — safe because cos_sim_f32() is read-only
  if (blob.byteOffset % 4 === 0) {
    return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  }
  // Copy only when misaligned (rare)
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

function parseExtra(extra: unknown): Record<string, any> {
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    return extra as Record<string, any>;
  }
  if (typeof extra === 'string') {
    try {
      const parsed = JSON.parse(extra);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, any>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function extractEntityCore(data: EntityData): {
  source_path: string | null;
  text_len: number | null;
  extra: Record<string, any>;
} {
  const source_path = typeof data.source_path === 'string' ? data.source_path : null;
  const text_len =
    typeof data.length === 'number'
      ? data.length
      : typeof data.text === 'string'
        ? data.text.length
        : null;

  const extra: Record<string, any> = { ...data };
  delete extra.path;
  delete extra.embeddings;
  delete extra.embedding_meta;
  delete extra.last_read;
  delete extra.last_embed;

  return { source_path, text_len, extra };
}

function getEntityType(collectionKey: string): 'source' | 'block' {
  return collectionKey === 'smart_blocks' ? 'block' : 'source';
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS entities (
    entity_key TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    path TEXT NOT NULL,
    source_path TEXT,
    last_read_hash TEXT,
    last_read_size INTEGER,
    last_read_mtime INTEGER,
    text_len INTEGER,
    extra TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type)`,
  `CREATE INDEX IF NOT EXISTS idx_entities_source_path ON entities(source_path)`,
  `CREATE TABLE IF NOT EXISTS entity_embeddings (
    entity_key TEXT NOT NULL,
    model_key TEXT NOT NULL,
    vec BLOB,
    tokens INTEGER,
    embed_hash TEXT,
    dims INTEGER,
    updated_at INTEGER,
    PRIMARY KEY (entity_key, model_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_embeddings_model_key ON entity_embeddings(model_key)`,
];

function ensureSchema(db: Database.Database): void {
  // NOTE: No FOREIGN KEY with ON DELETE CASCADE. PRAGMA foreign_keys is OFF (SQLite default).
  // Enabling it would break INSERT OR REPLACE (internally DELETE+INSERT), wiping embeddings.
  // Embedding cleanup on entity deletion is handled manually in executeSaveBatch.
  for (const sql of SCHEMA_STATEMENTS) {
    db.prepare(sql).run();
  }
}

// ---------------------------------------------------------------------------
// Module-level open databases (one per absolute db path)
// ---------------------------------------------------------------------------

const openDatabases = new Map<string, Database.Database>();

/**
 * Close all open better-sqlite3 databases.
 * Call this on plugin unload.
 */
export function closeBetterSqliteDatabases(): void {
  for (const db of openDatabases.values()) {
    try {
      db.close();
    } catch (err) {
      console.warn('[BetterSQLite] Failed to close database:', err);
    }
  }
  openDatabases.clear();
}

// ---------------------------------------------------------------------------
// BetterSqliteDataAdapter
// ---------------------------------------------------------------------------

type QueryMatch = { entity_key: string; score: number };

export class BetterSqliteDataAdapter<T extends EmbeddingEntity> {
  collection: EntityCollection<T>;
  collection_key: string;
  storage_namespace: string;
  entity_type: 'source' | 'block';

  private db: Database.Database | null = null;

  constructor(
    collection: EntityCollection<T>,
    collection_key: string,
    storage_namespace: string,
  ) {
    this.collection = collection;
    this.collection_key = collection_key;
    this.storage_namespace = storage_namespace;
    this.entity_type = getEntityType(collection_key);
  }

  initVaultContext(vaultAdapter: any, configDir: string, pluginId: string): void {
    const basePath = typeof vaultAdapter.getBasePath === 'function'
      ? vaultAdapter.getBasePath()
      : (() => { throw new Error('[BetterSQLite] vaultAdapter.getBasePath() not available'); })();
    const absoluteDbPath = join(basePath, configDir, 'plugins', pluginId, `${pluginId}.db`);
    mkdirSync(dirname(absoluteDbPath), { recursive: true });

    const existing = openDatabases.get(absoluteDbPath);
    if (existing?.open) {
      this.db = existing;
      return;
    }

    const db = new Database(absoluteDbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    ensureSchema(db);
    openDatabases.set(absoluteDbPath, db);
    this.db = db;
  }

  private requireDb(): Database.Database {
    if (!this.db?.open) {
      throw new Error('[BetterSQLite] Database not initialized — call initVaultContext first');
    }
    return this.db;
  }

  // -----------------------------------------------------------------------
  // load
  // -----------------------------------------------------------------------

  async load(): Promise<void> {
    const db = this.requireDb();
    const modelKey = this.collection.embed_model_key;

    const rows = db.prepare(`
      SELECT
        e.entity_key,
        e.path,
        e.source_path,
        e.last_read_hash,
        e.last_read_size,
        e.last_read_mtime,
        e.text_len,
        e.extra,
        em.tokens,
        em.embed_hash,
        em.dims,
        em.updated_at
      FROM entities e
      LEFT JOIN entity_embeddings em
        ON em.entity_key = e.entity_key
        AND em.model_key = ?
      WHERE e.entity_type = ?
      ORDER BY e.entity_key ASC
    `).all(modelKey, this.entity_type) as any[];

    for (const row of rows) {
      const extra = parseExtra(row.extra);
      const data: Partial<EntityData> = {
        ...extra,
        path: row.path as string,
        embeddings: {},
      };

      if (row.last_read_hash) {
        data.last_read = {
          hash: row.last_read_hash as string,
          size: row.last_read_size as number ?? undefined,
          mtime: row.last_read_mtime as number ?? undefined,
        };
      }

      if (row.embed_hash && modelKey && modelKey !== 'None') {
        data.last_embed = {
          hash: row.embed_hash as string,
          size: row.last_read_size as number ?? undefined,
          mtime: row.last_read_mtime as number ?? undefined,
        };
        data.embeddings = {
          [modelKey]: { vec: [], tokens: row.tokens as number ?? undefined },
        };
        data.embedding_meta = {
          [modelKey]: {
            hash: row.embed_hash as string,
            size: row.last_read_size as number ?? undefined,
            mtime: row.last_read_mtime as number ?? undefined,
            dims: row.dims as number ?? undefined,
            updated_at: row.updated_at as number ?? undefined,
          },
        };
      }

      const entity = this.collection.create_or_update(data);
      entity._queue_save = false;
      if (!entity.is_unembedded) {
        entity._queue_embed = false;
      }
    }
  }

  // -----------------------------------------------------------------------
  // save
  // -----------------------------------------------------------------------

  async save(): Promise<void> {
    const db = this.requireDb();
    const queue = [...this.collection.save_queue];
    const deletedKeys = this.collection.consume_deleted_keys();
    if (queue.length === 0 && deletedKeys.length === 0) return;
    this.executeSaveBatch(db, queue, deletedKeys, true);
  }

  async save_batch(entities: T[], deletedKeys: string[] = []): Promise<void> {
    const db = this.requireDb();
    const queue = [...entities];
    const pendingDeletedKeys = [...deletedKeys];
    if (queue.length === 0 && pendingDeletedKeys.length === 0) return;
    this.executeSaveBatch(db, queue, pendingDeletedKeys, false);
  }

  private executeSaveBatch(
    db: Database.Database,
    entities: T[],
    deletedKeys: string[],
    restoreDeletedKeys: boolean,
  ): void {
    const savedEntities: T[] = [];

    // Prepare statements once per batch for performance
    const deleteEmbeddingsStmt = db.prepare('DELETE FROM entity_embeddings WHERE entity_key = ?');
    const deleteEntityStmt = db.prepare('DELETE FROM entities WHERE entity_key = ?');
    const upsertEntityStmt = db.prepare(`
      INSERT OR REPLACE INTO entities (
        entity_key, entity_type, path, source_path,
        last_read_hash, last_read_size, last_read_mtime,
        text_len, extra
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const upsertEmbedStmt = db.prepare(`
      INSERT OR REPLACE INTO entity_embeddings (
        entity_key, model_key, vec, tokens, embed_hash, dims, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const updateEmbedHashStmt = db.prepare(`
      UPDATE entity_embeddings SET embed_hash = ?, dims = ?, updated_at = ?
      WHERE entity_key = ? AND model_key = ?
    `);
    const removeAllEmbedStmt = db.prepare('DELETE FROM entity_embeddings WHERE entity_key = ?');

    try {
      const runBatch = db.transaction(() => {
        // Manual cascade: delete embeddings first, then entity.
        // This is the ONLY cleanup mechanism — ON DELETE CASCADE is intentionally off.
        for (const key of deletedKeys) {
          deleteEmbeddingsStmt.run(key);
          deleteEntityStmt.run(key);
        }

        for (const entity of entities) {
          if (!entity.validate_save()) {
            entity._queue_save = false;
            continue;
          }
          this.upsertEntityWith(upsertEntityStmt, entity);
          this.upsertEmbeddingWith(upsertEmbedStmt, updateEmbedHashStmt, removeAllEmbedStmt, entity);
          savedEntities.push(entity);
        }
      });

      runBatch();

      for (const entity of savedEntities) {
        entity._queue_save = false;
      }
    } catch (error) {
      if (restoreDeletedKeys && deletedKeys.length > 0) {
        this.collection.restore_deleted_keys(deletedKeys);
      }
      throw error;
    }
  }

  private upsertEntityWith(stmt: Database.Statement, entity: T): void {
    const data = entity.data;
    const { source_path, text_len, extra } = extractEntityCore(data);
    const lastRead = data.last_read;

    stmt.run(
      entity.key,
      this.entity_type,
      data.path,
      source_path,
      lastRead?.hash ?? null,
      lastRead?.size ?? null,
      lastRead?.mtime ?? null,
      text_len,
      JSON.stringify(extra),
    );
  }

  private upsertEmbeddingWith(
    upsertStmt: Database.Statement,
    updateHashStmt: Database.Statement,
    removeAllStmt: Database.Statement,
    entity: T,
  ): void {
    if ((entity as any)._remove_all_embeddings) {
      removeAllStmt.run(entity.key);
      (entity as any)._remove_all_embeddings = false;
      return;
    }

    const modelKey = entity.embed_model_key;
    if (!modelKey || modelKey === 'None') return;

    const embedding = entity.data.embeddings?.[modelKey];
    const vec = embedding?.vec;
    const meta = entity.data.embedding_meta?.[modelKey];

    if (!vec || vec.length === 0) {
      // Vec is lazy-loaded. Sync embed_hash so next load doesn't falsely mark unembedded.
      if (!meta) return;
      updateHashStmt.run(meta.hash ?? null, meta.dims ?? null, meta.updated_at ?? Date.now(), entity.key, modelKey);
      return;
    }

    const embedHash =
      meta?.hash ?? entity.data.last_embed?.hash ?? entity.data.last_read?.hash ?? null;
    const dims = meta?.dims ?? vec.length;
    const updatedAt = meta?.updated_at ?? Date.now();

    upsertStmt.run(
      entity.key,
      modelKey,
      vecToBlob(vec),
      embedding?.tokens ?? null,
      embedHash,
      dims ?? null,
      updatedAt,
    );
  }

  // -----------------------------------------------------------------------
  // load_entity_vector
  // -----------------------------------------------------------------------

  async load_entity_vector(
    entityKey: string,
    modelKey: string,
  ): Promise<{
    vec: Float32Array | null;
    tokens?: number;
    meta?: EmbeddingModelMeta;
  }> {
    const db = this.requireDb();
    const row = db.prepare(`
      SELECT vec, tokens, embed_hash, dims, updated_at
      FROM entity_embeddings
      WHERE entity_key = ? AND model_key = ?
      LIMIT 1
    `).get(entityKey, modelKey) as any;

    if (!row) return { vec: null };

    const vec = blobToF32(row.vec as Buffer | null);
    const meta = row.embed_hash
      ? {
        hash: row.embed_hash as string,
        dims: row.dims as number ?? undefined,
        updated_at: row.updated_at as number ?? undefined,
      }
      : undefined;

    return {
      vec,
      tokens: row.tokens as number ?? undefined,
      meta,
    };
  }

  // -----------------------------------------------------------------------
  // query_nearest (JS-based cosine similarity)
  // -----------------------------------------------------------------------

  async query_nearest(
    vec: number[] | Float32Array,
    filter: SearchFilter = {},
    fetchMultiplier: number = 3,
  ): Promise<QueryMatch[]> {
    if (!vec || vec.length === 0) return [];

    const modelKey = this.collection.embed_model_key;
    if (!modelKey || modelKey === 'None') return [];

    const db = this.requireDb();
    const limit = Math.max(1, filter.limit ?? 50);
    const fetchLimit = Math.max(limit, limit * Math.max(1, fetchMultiplier));

    const conditions: string[] = [
      'em.model_key = ?',
      'e.entity_type = ?',
      'e.last_read_hash IS NOT NULL',
      'em.embed_hash = e.last_read_hash',
    ];
    const params: any[] = [modelKey, this.entity_type];

    const expectedDims = this.collection.embed_model_dims;
    if (typeof expectedDims === 'number' && expectedDims > 0) {
      conditions.push('(em.dims IS NULL OR em.dims = ?)');
      params.push(expectedDims);
    }

    if (filter.key_starts_with) {
      conditions.push('e.entity_key LIKE ?');
      params.push(`${filter.key_starts_with}%`);
    }

    if (filter.key_does_not_start_with) {
      conditions.push('e.entity_key NOT LIKE ?');
      params.push(`${filter.key_does_not_start_with}%`);
    }

    if (filter.include && filter.include.length > 0) {
      const placeholders = filter.include.map(() => '?').join(',');
      conditions.push(`e.entity_key IN (${placeholders})`);
      params.push(...filter.include);
    }

    if (filter.exclude && filter.exclude.length > 0) {
      const placeholders = filter.exclude.map(() => '?').join(',');
      conditions.push(`e.entity_key NOT IN (${placeholders})`);
      params.push(...filter.exclude);
    }

    const sql = `
      SELECT em.entity_key, em.vec
      FROM entity_embeddings em
      JOIN entities e ON e.entity_key = em.entity_key
      WHERE ${conditions.join(' AND ')}
    `;

    const rows = db.prepare(sql).all(...params) as any[];
    const queryF32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
    const scored: QueryMatch[] = [];

    for (const row of rows) {
      const candidateVec = blobToF32(row.vec as Buffer | null);
      if (!candidateVec || candidateVec.length !== queryF32.length) continue;

      const score = cos_sim_f32(queryF32, candidateVec);
      if (filter.min_score !== undefined && score < filter.min_score) continue;
      scored.push({ entity_key: row.entity_key as string, score });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, fetchLimit);
  }
}
