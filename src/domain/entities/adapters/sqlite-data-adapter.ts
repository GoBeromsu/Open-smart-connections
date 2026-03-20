/**
 * @file sqlite-data-adapter.ts
 * @description SQLite (sql.js WASM) data adapter for entity persistence.
 * Replaces PGlite for improved stability and simplicity.
 */

import initSqlJs, { type Database as SqlJsDatabase } from 'sql.js';
import type { EmbeddingEntity } from '../EmbeddingEntity';
import type { EntityCollection } from '../EntityCollection';
import type { EntityData, EmbeddingModelMeta, SearchFilter } from '../../../types/entities';
import { cos_sim } from '../../../utils/cos_sim';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SQL_WASM_CDN = 'https://cdn.jsdelivr.net/npm/sql.js@1.12.0/dist/sql-wasm.wasm';
const AUTOSAVE_INTERVAL_MS = 30_000;

// ---------------------------------------------------------------------------
// Module-level singletons
// ---------------------------------------------------------------------------

let sqlJsPromise: Promise<typeof import('sql.js').default> | null = null;
const dbInstances = new Map<string, Promise<SqlJsDatabase>>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toDbKey(storageNamespace: string): string {
  return storageNamespace
    .replace(/\/(sources|blocks)$/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 200) || 'open_connections';
}

function vecToBlob(vec: number[]): Uint8Array {
  const f32 = new Float32Array(vec);
  return new Uint8Array(f32.buffer);
}

function blobToVec(blob: Uint8Array | ArrayBuffer | null): number[] | null {
  if (!blob) return null;
  const buf = blob instanceof Uint8Array ? blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength) : blob;
  if (buf.byteLength === 0 || buf.byteLength % 4 !== 0) return null;
  return Array.from(new Float32Array(buf));
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

// ---------------------------------------------------------------------------
// Database lifecycle
// ---------------------------------------------------------------------------

interface DbContext {
  db: SqlJsDatabase;
  dbPath: string;
  vaultAdapter: any; // Obsidian DataAdapter
  autosaveTimer: ReturnType<typeof setInterval> | null;
}

const dbContexts = new Map<string, DbContext>();

async function loadSqlJs(wasmBinary?: ArrayBuffer): Promise<typeof import('sql.js').default> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const opts: any = {};
      if (wasmBinary) {
        opts.wasmBinary = wasmBinary;
      } else {
        opts.locateFile = () => SQL_WASM_CDN;
      }
      return (await initSqlJs(opts)) as any;
    })();
  }
  return sqlJsPromise;
}

function ensureSchema(db: SqlJsDatabase): void {
  db.run(`
    CREATE TABLE IF NOT EXISTS entities (
      entity_key TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      path TEXT NOT NULL,
      source_path TEXT,
      last_read_hash TEXT,
      last_read_size INTEGER,
      last_read_mtime INTEGER,
      text_len INTEGER,
      extra TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
    CREATE INDEX IF NOT EXISTS idx_entities_source_path ON entities(source_path);

    CREATE TABLE IF NOT EXISTS entity_embeddings (
      entity_key TEXT NOT NULL,
      model_key TEXT NOT NULL,
      vec BLOB,
      tokens INTEGER,
      embed_hash TEXT,
      dims INTEGER,
      updated_at INTEGER,
      PRIMARY KEY (entity_key, model_key),
      FOREIGN KEY (entity_key) REFERENCES entities(entity_key) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_embeddings_model_key ON entity_embeddings(model_key);
  `);
}

async function persistDb(ctx: DbContext): Promise<void> {
  try {
    const data = ctx.db.export();
    const buffer = Buffer.from(data);
    await ctx.vaultAdapter.writeBinary(ctx.dbPath, buffer);
  } catch (err) {
    console.error('[SQLite] Failed to persist database:', err);
  }
}

async function createDb(
  storageNamespace: string,
  vaultAdapter: any,
  configDir: string,
  pluginId: string,
): Promise<SqlJsDatabase> {
  const dbKey = toDbKey(storageNamespace);
  const dbPath = `${configDir}/plugins/${pluginId}/${pluginId}.db`;

  // Try to load WASM from local plugin directory, fallback to CDN
  let wasmBinary: ArrayBuffer | undefined;
  try {
    const wasmPath = `${configDir}/plugins/${pluginId}/sql-wasm.wasm`;
    wasmBinary = await vaultAdapter.readBinary(wasmPath);
  } catch {
    console.log('[SQLite] WASM not found locally, using CDN fallback');
  }

  const SQL = await loadSqlJs(wasmBinary);

  // Try loading existing database
  let db: SqlJsDatabase;
  try {
    const existing = await vaultAdapter.readBinary(dbPath);
    db = new SQL.Database(new Uint8Array(existing));
    console.log('[SQLite] Loaded existing database');
  } catch {
    db = new SQL.Database();
    console.log('[SQLite] Created new database');
  }

  ensureSchema(db);

  // Set up autosave and context
  const ctx: DbContext = {
    db,
    dbPath,
    vaultAdapter,
    autosaveTimer: setInterval(() => persistDb(ctx), AUTOSAVE_INTERVAL_MS),
  };
  dbContexts.set(dbKey, ctx);

  return db;
}

async function getDb(
  storageNamespace: string,
  vaultAdapter?: any,
  configDir?: string,
  pluginId?: string,
): Promise<SqlJsDatabase> {
  const key = toDbKey(storageNamespace);
  if (!dbInstances.has(key)) {
    if (!vaultAdapter || !configDir || !pluginId) {
      throw new Error('[SQLite] Cannot create DB without vault adapter context');
    }
    dbInstances.set(key, createDb(storageNamespace, vaultAdapter, configDir, pluginId));
  }
  return dbInstances.get(key)!;
}

/**
 * Persist all databases and clean up timers.
 * Call this on plugin unload.
 */
export async function closeSqliteDatabases(): Promise<void> {
  for (const [_key, ctx] of dbContexts) {
    if (ctx.autosaveTimer) clearInterval(ctx.autosaveTimer);
    await persistDb(ctx);
    ctx.db.close();
  }
  dbContexts.clear();
  dbInstances.clear();
  sqlJsPromise = null;
}

// ---------------------------------------------------------------------------
// SqliteDataAdapter
// ---------------------------------------------------------------------------

type QueryMatch = { entity_key: string; score: number };

export class SqliteDataAdapter<T extends EmbeddingEntity> {
  collection: EntityCollection<T>;
  collection_key: string;
  storage_namespace: string;
  entity_type: 'source' | 'block';

  // Vault context — set via initVaultContext() before first use
  private vaultAdapter: any;
  private configDir: string = '';
  private pluginId: string = '';

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

  /**
   * Provide the Obsidian vault context required for DB file I/O.
   * Must be called before load/save.
   */
  initVaultContext(vaultAdapter: any, configDir: string, pluginId: string): void {
    this.vaultAdapter = vaultAdapter;
    this.configDir = configDir;
    this.pluginId = pluginId;
  }

  private async db(): Promise<SqlJsDatabase> {
    return getDb(this.storage_namespace, this.vaultAdapter, this.configDir, this.pluginId);
  }

  // -----------------------------------------------------------------------
  // load
  // -----------------------------------------------------------------------

  async load(): Promise<void> {
    const db = await this.db();
    const modelKey = this.collection.embed_model_key;

    const stmt = db.prepare(`
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
    `);
    stmt.bind([modelKey, this.entity_type]);

    while (stmt.step()) {
      const row = stmt.getAsObject({ ':modelKey': modelKey });
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
    stmt.free();
  }

  // -----------------------------------------------------------------------
  // save
  // -----------------------------------------------------------------------

  async save(): Promise<void> {
    const queue = this.collection.save_queue;
    const deletedKeys = this.collection.consume_deleted_keys();
    if (queue.length === 0 && deletedKeys.length === 0) return;
    await this.save_batch(queue, deletedKeys);
  }

  async save_batch(entities: T[], deletedKeys: string[] = []): Promise<void> {
    const db = await this.db();

    db.run('BEGIN TRANSACTION');
    try {
      for (const key of deletedKeys) {
        db.run('DELETE FROM entity_embeddings WHERE entity_key = ?', [key]);
        db.run('DELETE FROM entities WHERE entity_key = ?', [key]);
      }

      for (const entity of entities) {
        if (!entity.validate_save()) {
          entity._queue_save = false;
          continue;
        }
        this.upsertEntity(db, entity);
        this.upsertEmbedding(db, entity);
        entity._queue_save = false;
      }

      db.run('COMMIT');
    } catch (err) {
      db.run('ROLLBACK');
      throw err;
    }
  }

  private upsertEntity(db: SqlJsDatabase, entity: T): void {
    const data = entity.data;
    const { source_path, text_len, extra } = extractEntityCore(data);
    const lastRead = data.last_read;

    db.run(
      `INSERT OR REPLACE INTO entities (
        entity_key, entity_type, path, source_path,
        last_read_hash, last_read_size, last_read_mtime,
        text_len, extra
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.key,
        this.entity_type,
        data.path,
        source_path,
        lastRead?.hash ?? null,
        lastRead?.size ?? null,
        lastRead?.mtime ?? null,
        text_len,
        JSON.stringify(extra),
      ],
    );
  }

  private upsertEmbedding(db: SqlJsDatabase, entity: T): void {
    if ((entity as any)._remove_all_embeddings) {
      db.run('DELETE FROM entity_embeddings WHERE entity_key = ?', [entity.key]);
      (entity as any)._remove_all_embeddings = false;
      return;
    }

    const modelKey = entity.embed_model_key;
    if (!modelKey || modelKey === 'None') return;

    const embedding = entity.data.embeddings?.[modelKey];
    const vec = embedding?.vec;
    if (!vec || vec.length === 0) return;

    const meta = entity.data.embedding_meta?.[modelKey];
    const embedHash =
      meta?.hash ?? entity.data.last_embed?.hash ?? entity.data.last_read?.hash ?? null;
    const dims = meta?.dims ?? vec.length;
    const updatedAt = meta?.updated_at ?? Date.now();

    db.run(
      `INSERT OR REPLACE INTO entity_embeddings (
        entity_key, model_key, vec, tokens, embed_hash, dims, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entity.key,
        modelKey,
        vecToBlob(vec),
        embedding?.tokens ?? null,
        embedHash,
        dims ?? null,
        updatedAt,
      ],
    );
  }

  // -----------------------------------------------------------------------
  // load_entity_vector
  // -----------------------------------------------------------------------

  async load_entity_vector(
    entityKey: string,
    modelKey: string,
  ): Promise<{
    vec: number[] | null;
    tokens?: number;
    meta?: EmbeddingModelMeta;
  }> {
    const db = await this.db();
    const stmt = db.prepare(`
      SELECT vec, tokens, embed_hash, dims, updated_at
      FROM entity_embeddings
      WHERE entity_key = ? AND model_key = ?
      LIMIT 1
    `);
    stmt.bind([entityKey, modelKey]);

    if (!stmt.step()) {
      stmt.free();
      return { vec: null };
    }

    const row = stmt.getAsObject();
    stmt.free();

    const vec = blobToVec(row.vec as Uint8Array | null);
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
    vec: number[],
    filter: SearchFilter = {},
    fetchMultiplier: number = 3,
  ): Promise<QueryMatch[]> {
    if (!vec || !Array.isArray(vec) || vec.length === 0) return [];

    const db = await this.db();
    const modelKey = this.collection.embed_model_key;
    if (!modelKey || modelKey === 'None') return [];

    const limit = Math.max(1, filter.limit ?? 50);
    const fetchLimit = Math.max(limit, limit * Math.max(1, fetchMultiplier));

    // Build WHERE clause
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

    const stmt = db.prepare(sql);
    stmt.bind(params);

    // Compute cosine similarity in JS
    const scored: QueryMatch[] = [];
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const candidateVec = blobToVec(row.vec as Uint8Array | null);
      if (!candidateVec || candidateVec.length !== vec.length) continue;

      const score = cos_sim(vec, candidateVec);

      if (filter.min_score !== undefined && score < filter.min_score) continue;

      scored.push({ entity_key: row.entity_key as string, score });
    }
    stmt.free();

    // Sort descending by score and take top N
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, fetchLimit);
  }
}
