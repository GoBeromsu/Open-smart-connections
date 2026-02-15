/**
 * @file pglite-data-adapter.ts
 * @description PGlite (WASM Postgres) data adapter for entity persistence
 */

import { PGlite } from '@electric-sql/pglite';
import type { EmbeddingEntity } from '../EmbeddingEntity';
import type { EntityCollection } from '../EntityCollection';
import type { EntityData, EmbeddingModelMeta, SearchFilter } from '../../types/entities';

const PGLITE_VERSION = '0.2.12';
const PGLITE_POSTGRES_DATA_URL =
  `https://unpkg.com/@electric-sql/pglite@${PGLITE_VERSION}/dist/postgres.data`;
const PGLITE_POSTGRES_WASM_URL =
  `https://unpkg.com/@electric-sql/pglite@${PGLITE_VERSION}/dist/postgres.wasm`;
const PGLITE_VECTOR_EXT_URL =
  `https://unpkg.com/@electric-sql/pglite@${PGLITE_VERSION}/dist/vector.tar.gz`;

type DbNearestRow = {
  entity_key: string;
  score: number | string;
};

type DbVectorRow = {
  vec_text: string;
  tokens: number | null;
  embed_hash: string | null;
  dims: number | null;
  updated_at: number | null;
};

type QueryMatch = {
  entity_key: string;
  score: number;
};

const db_instances = new Map<string, Promise<PGlite>>();

let pglite_resource_promise:
  | Promise<{ fsBundle: Blob; wasmModule: WebAssembly.Module; vectorExtUrl: URL }>
  | null = null;

function get_root_namespace(storage_namespace: string): string {
  return storage_namespace.replace(/\/(sources|blocks)$/, '');
}

function to_db_key(namespace: string): string {
  return get_root_namespace(namespace)
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 200) || 'open_smart_connections';
}

function to_idb_data_dir(namespace: string): string {
  return `idb://osc_${to_db_key(namespace)}`;
}

async function fetch_blob(url: string): Promise<Blob> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch PGlite resource: ${url} (${resp.status})`);
  }
  return await resp.blob();
}

async function fetch_array_buffer(url: string): Promise<ArrayBuffer> {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch PGlite resource: ${url} (${resp.status})`);
  }
  return await resp.arrayBuffer();
}

async function load_pglite_resources():
Promise<{ fsBundle: Blob; wasmModule: WebAssembly.Module; vectorExtUrl: URL }> {
  if (!pglite_resource_promise) {
    pglite_resource_promise = (async () => {
      const [fsBundle, wasmBuffer] = await Promise.all([
        fetch_blob(PGLITE_POSTGRES_DATA_URL),
        fetch_array_buffer(PGLITE_POSTGRES_WASM_URL),
      ]);
      const wasmModule = await WebAssembly.compile(wasmBuffer);
      return {
        fsBundle,
        wasmModule,
        vectorExtUrl: new URL(PGLITE_VECTOR_EXT_URL),
      };
    })();
  }
  return await pglite_resource_promise;
}

async function ensure_schema(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE EXTENSION IF NOT EXISTS vector;

    CREATE TABLE IF NOT EXISTS entities (
      entity_key TEXT PRIMARY KEY,
      entity_type TEXT NOT NULL,
      path TEXT NOT NULL,
      source_path TEXT NULL,
      last_read_hash TEXT NULL,
      last_read_size INTEGER NULL,
      last_read_mtime BIGINT NULL,
      text_len INTEGER NULL,
      extra JSONB NOT NULL DEFAULT '{}'::jsonb
    );

    CREATE TABLE IF NOT EXISTS entity_embeddings (
      entity_key TEXT NOT NULL REFERENCES entities(entity_key) ON DELETE CASCADE,
      model_key TEXT NOT NULL,
      vec vector NOT NULL,
      tokens INTEGER NULL,
      embed_hash TEXT NULL,
      dims INTEGER NULL,
      updated_at BIGINT NOT NULL,
      PRIMARY KEY (entity_key, model_key)
    );

    CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
    CREATE INDEX IF NOT EXISTS idx_entities_source_path ON entities(source_path);
    CREATE INDEX IF NOT EXISTS idx_embeddings_model_key ON entity_embeddings(model_key);
  `);
}

async function create_db(storage_namespace: string): Promise<PGlite> {
  const resources = await load_pglite_resources();
  const db = await PGlite.create({
    dataDir: to_idb_data_dir(storage_namespace),
    fsBundle: resources.fsBundle,
    wasmModule: resources.wasmModule,
    extensions: {
      vector: resources.vectorExtUrl,
    },
  });
  await ensure_schema(db);
  return db;
}

async function get_db(storage_namespace: string): Promise<PGlite> {
  const key = to_db_key(storage_namespace);
  if (!db_instances.has(key)) {
    db_instances.set(key, create_db(storage_namespace));
  }
  return await db_instances.get(key)!;
}

function to_vector_literal(vec: number[]): string {
  return `[${vec.join(',')}]`;
}

function parse_vector_literal(vec_text: string | null | undefined): number[] | null {
  if (!vec_text || typeof vec_text !== 'string') return null;
  try {
    const parsed = JSON.parse(vec_text);
    if (!Array.isArray(parsed)) return null;
    return parsed.map((n) => Number(n)).filter((n) => Number.isFinite(n));
  } catch {
    return null;
  }
}

function parse_extra(extra: unknown): Record<string, any> {
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

function parse_score(score: unknown): number {
  if (typeof score === 'number') return score;
  if (typeof score === 'string') {
    const n = Number(score);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function extract_entity_core(data: EntityData): {
  source_path: string | null;
  text_len: number | null;
  extra: Record<string, any>;
} {
  const source_path = typeof data.source_path === 'string' ? data.source_path : null;
  const text_len = typeof data.length === 'number'
    ? data.length
    : (typeof data.text === 'string' ? data.text.length : null);

  const extra: Record<string, any> = { ...data };
  delete extra.path;
  delete extra.embeddings;
  delete extra.embedding_meta;
  delete extra.last_read;
  delete extra.last_embed;

  return { source_path, text_len, extra };
}

function get_entity_type(collection_key: string): 'source' | 'block' {
  return collection_key === 'smart_blocks' ? 'block' : 'source';
}

export class PgliteDataAdapter<T extends EmbeddingEntity> {
  collection: EntityCollection<T>;
  collection_key: string;
  storage_namespace: string;
  entity_type: 'source' | 'block';

  constructor(
    collection: EntityCollection<T>,
    collection_key: string,
    storage_namespace: string,
  ) {
    this.collection = collection;
    this.collection_key = collection_key;
    this.storage_namespace = storage_namespace;
    this.entity_type = get_entity_type(collection_key);
  }

  async load(): Promise<void> {
    const db = await get_db(this.storage_namespace);
    const model_key = this.collection.embed_model_key;
    const rows = await db.query<{
      entity_key: string;
      path: string;
      source_path: string | null;
      last_read_hash: string | null;
      last_read_size: number | null;
      last_read_mtime: number | null;
      text_len: number | null;
      extra: unknown;
      tokens: number | null;
      embed_hash: string | null;
      dims: number | null;
      updated_at: number | null;
    }>(
      `
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
        AND em.model_key = $1
      WHERE e.entity_type = $2
      ORDER BY e.entity_key ASC
      `,
      [model_key, this.entity_type],
    );

    for (const row of rows.rows) {
      const extra = parse_extra(row.extra);
      const data: Partial<EntityData> = {
        ...extra,
        path: row.path,
        embeddings: {},
      };

      if (row.last_read_hash) {
        data.last_read = {
          hash: row.last_read_hash,
          size: row.last_read_size ?? undefined,
          mtime: row.last_read_mtime ?? undefined,
        };
      }

      if (row.embed_hash && model_key && model_key !== 'None') {
        data.last_embed = {
          hash: row.embed_hash,
          size: row.last_read_size ?? undefined,
          mtime: row.last_read_mtime ?? undefined,
        };
        data.embeddings = {
          [model_key]: { vec: [], tokens: row.tokens ?? undefined },
        };
        data.embedding_meta = {
          [model_key]: {
            hash: row.embed_hash,
            size: row.last_read_size ?? undefined,
            mtime: row.last_read_mtime ?? undefined,
            dims: row.dims ?? undefined,
            updated_at: row.updated_at ?? undefined,
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

  async save(): Promise<void> {
    const queue = this.collection.save_queue;
    const deleted_keys = this.collection.consume_deleted_keys();
    if (queue.length === 0 && deleted_keys.length === 0) return;
    await this.save_batch(queue, deleted_keys);
  }

  async save_batch(entities: T[], deleted_keys: string[] = []): Promise<void> {
    const db = await get_db(this.storage_namespace);

    for (const key of deleted_keys) {
      await db.query('DELETE FROM entities WHERE entity_key = $1', [key]);
    }

    for (const entity of entities) {
      if (!entity.validate_save()) {
        entity._queue_save = false;
        continue;
      }

      await this.upsert_entity(db, entity);
      await this.upsert_embedding(db, entity);
      entity._queue_save = false;
    }
  }

  private async upsert_entity(db: PGlite, entity: T): Promise<void> {
    const data = entity.data;
    const { source_path, text_len, extra } = extract_entity_core(data);
    const last_read = data.last_read;

    await db.query(
      `
      INSERT INTO entities (
        entity_key,
        entity_type,
        path,
        source_path,
        last_read_hash,
        last_read_size,
        last_read_mtime,
        text_len,
        extra
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (entity_key)
      DO UPDATE SET
        entity_type = EXCLUDED.entity_type,
        path = EXCLUDED.path,
        source_path = EXCLUDED.source_path,
        last_read_hash = EXCLUDED.last_read_hash,
        last_read_size = EXCLUDED.last_read_size,
        last_read_mtime = EXCLUDED.last_read_mtime,
        text_len = EXCLUDED.text_len,
        extra = EXCLUDED.extra
      `,
      [
        entity.key,
        this.entity_type,
        data.path,
        source_path,
        last_read?.hash ?? null,
        last_read?.size ?? null,
        last_read?.mtime ?? null,
        text_len,
        JSON.stringify(extra),
      ],
    );
  }

  private async upsert_embedding(db: PGlite, entity: T): Promise<void> {
    if ((entity as any)._remove_all_embeddings) {
      await db.query('DELETE FROM entity_embeddings WHERE entity_key = $1', [entity.key]);
      (entity as any)._remove_all_embeddings = false;
      return;
    }

    const model_key = entity.embed_model_key;
    if (!model_key || model_key === 'None') return;

    const embedding = entity.data.embeddings?.[model_key];
    const vec = embedding?.vec;
    if (!vec || vec.length === 0) {
      return;
    }

    const meta = entity.data.embedding_meta?.[model_key];
    const embed_hash = meta?.hash ?? entity.data.last_embed?.hash ?? entity.data.last_read?.hash ?? null;
    const dims = meta?.dims ?? vec.length;
    const updated_at = meta?.updated_at ?? Date.now();

    await db.query(
      `
      INSERT INTO entity_embeddings (
        entity_key,
        model_key,
        vec,
        tokens,
        embed_hash,
        dims,
        updated_at
      )
      VALUES ($1, $2, $3::vector, $4, $5, $6, $7)
      ON CONFLICT (entity_key, model_key)
      DO UPDATE SET
        vec = EXCLUDED.vec,
        tokens = EXCLUDED.tokens,
        embed_hash = EXCLUDED.embed_hash,
        dims = EXCLUDED.dims,
        updated_at = EXCLUDED.updated_at
      `,
      [
        entity.key,
        model_key,
        to_vector_literal(vec),
        embedding?.tokens ?? null,
        embed_hash,
        dims ?? null,
        updated_at,
      ],
    );
  }

  async load_entity_vector(entity_key: string, model_key: string): Promise<{
    vec: number[] | null;
    tokens?: number;
    meta?: EmbeddingModelMeta;
  }> {
    const db = await get_db(this.storage_namespace);
    const row_result = await db.query<DbVectorRow>(
      `
      SELECT
        vec::text AS vec_text,
        tokens,
        embed_hash,
        dims,
        updated_at
      FROM entity_embeddings
      WHERE entity_key = $1
        AND model_key = $2
      LIMIT 1
      `,
      [entity_key, model_key],
    );

    const row = row_result.rows[0];
    if (!row) {
      return { vec: null };
    }

    const vec = parse_vector_literal(row.vec_text);
    const meta = row.embed_hash
      ? {
        hash: row.embed_hash,
        dims: row.dims ?? undefined,
        updated_at: row.updated_at ?? undefined,
      }
      : undefined;

    return {
      vec,
      tokens: row.tokens ?? undefined,
      meta,
    };
  }

  async query_nearest(
    vec: number[],
    filter: SearchFilter = {},
    fetch_multiplier: number = 3,
  ): Promise<QueryMatch[]> {
    if (!vec || !Array.isArray(vec) || vec.length === 0) return [];

    const db = await get_db(this.storage_namespace);
    const model_key = this.collection.embed_model_key;
    if (!model_key || model_key === 'None') return [];

    const limit = Math.max(1, filter.limit ?? 50);
    const fetch_limit = Math.max(limit, limit * Math.max(1, fetch_multiplier));
    const params: any[] = [];
    const push_param = (value: any): string => {
      params.push(value);
      return `$${params.length}`;
    };

    const vec_param = push_param(to_vector_literal(vec));
    const model_param = push_param(model_key);
    const type_param = push_param(this.entity_type);

    const where: string[] = [
      `em.model_key = ${model_param}`,
      `e.entity_type = ${type_param}`,
      'e.last_read_hash IS NOT NULL',
      'em.embed_hash = e.last_read_hash',
    ];

    const min_score = typeof filter.min_score === 'number' ? filter.min_score : undefined;
    if (min_score !== undefined) {
      const min_score_param = push_param(min_score);
      where.push(`(1 - (em.vec <=> ${vec_param}::vector)) >= ${min_score_param}`);
    }

    if (typeof this.collection.embed_model_dims === 'number' && this.collection.embed_model_dims > 0) {
      const dims_param = push_param(this.collection.embed_model_dims);
      where.push(`(em.dims IS NULL OR em.dims = ${dims_param})`);
    }

    if (filter.key_starts_with) {
      const prefix_param = push_param(`${filter.key_starts_with}%`);
      where.push(`e.entity_key LIKE ${prefix_param}`);
    }

    if (filter.key_does_not_start_with) {
      const prefix_param = push_param(`${filter.key_does_not_start_with}%`);
      where.push(`e.entity_key NOT LIKE ${prefix_param}`);
    }

    if (filter.include && filter.include.length > 0) {
      const include_param = push_param(filter.include);
      where.push(`e.entity_key = ANY(${include_param})`);
    }

    if (filter.exclude && filter.exclude.length > 0) {
      const exclude_param = push_param(filter.exclude);
      where.push(`NOT (e.entity_key = ANY(${exclude_param}))`);
    }

    const limit_param = push_param(fetch_limit);

    const result = await db.query<DbNearestRow>(
      `
      SELECT
        e.entity_key,
        1 - (em.vec <=> ${vec_param}::vector) AS score
      FROM entity_embeddings em
      JOIN entities e ON e.entity_key = em.entity_key
      WHERE ${where.join(' AND ')}
      ORDER BY em.vec <=> ${vec_param}::vector ASC
      LIMIT ${limit_param}
      `,
      params,
    );

    return result.rows.map((row: DbNearestRow) => ({
      entity_key: row.entity_key,
      score: parse_score(row.score),
    }));
  }
}
