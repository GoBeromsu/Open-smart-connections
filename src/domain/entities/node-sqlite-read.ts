import type { DatabaseSync } from 'node:sqlite';

import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityCollection } from './EntityCollection';
import type { EntityData, EmbeddingModelMeta, SearchFilter } from '../../types/entities';
import { cos_sim_f32, processInChunks } from '../../utils';
import { blobToF32, parseExtra } from './node-sqlite-helpers';
import type { EmbeddingRow, EntityRow, NearestRow, QueryMatch } from './node-sqlite-types';

export function loadNodeSqliteEntities<T extends EmbeddingEntity>(
  db: DatabaseSync,
  collection: EntityCollection<T>,
  entity_type: 'source' | 'block',
): void {
  const modelKey = collection.embed_model_key;
  const rows = db.prepare(`
    SELECT
      e.entity_key, e.path, e.source_path, e.last_read_hash, e.last_read_size,
      e.last_read_mtime, e.text_len, e.extra, em.tokens, em.embed_hash, em.dims, em.updated_at
    FROM entities e
    LEFT JOIN entity_embeddings em
      ON em.entity_key = e.entity_key AND em.model_key = ?
    WHERE e.entity_type = ?
    ORDER BY e.entity_key ASC
  `).all(modelKey, entity_type) as unknown as EntityRow[];

  for (const row of rows) {
    const extra = parseExtra(row.extra);
    const data: Partial<EntityData> = { ...extra, path: row.path, embeddings: {} };
    if (row.last_read_hash) {
      data.last_read = {
        hash: row.last_read_hash,
        size: row.last_read_size ?? undefined,
        mtime: row.last_read_mtime ?? undefined,
      };
    }
    if (row.embed_hash && modelKey && modelKey !== 'None') {
      data.last_embed = {
        hash: row.embed_hash,
        size: row.last_read_size ?? undefined,
        mtime: row.last_read_mtime ?? undefined,
      };
      data.embeddings = { [modelKey]: { vec: [], tokens: row.tokens ?? undefined } };
      data.embedding_meta = {
        [modelKey]: {
          hash: row.embed_hash,
          size: row.last_read_size ?? undefined,
          mtime: row.last_read_mtime ?? undefined,
          dims: row.dims ?? undefined,
          updated_at: row.updated_at ?? undefined,
        },
      };
    }

    const entity = collection.create_or_update(data);
    entity._queue_save = false;
    if (!entity.is_unembedded) {
      entity._queue_embed = false;
    }
  }
}

export function loadNodeSqliteEntityVector(
  db: DatabaseSync,
  entityKey: string,
  modelKey: string,
): { vec: Float32Array | null; tokens?: number; meta?: EmbeddingModelMeta } {
  const row = db.prepare(`
    SELECT vec, tokens, embed_hash, dims, updated_at
    FROM entity_embeddings
    WHERE entity_key = ? AND model_key = ?
    LIMIT 1
  `).get(entityKey, modelKey) as EmbeddingRow | undefined;
  if (!row) return { vec: null };

  return {
    vec: blobToF32(row.vec),
    tokens: row.tokens ?? undefined,
    meta: row.embed_hash
      ? {
          hash: row.embed_hash,
          dims: row.dims ?? undefined,
          updated_at: row.updated_at ?? undefined,
        }
      : undefined,
  };
}

export async function queryNodeSqliteNearest(
  db: DatabaseSync,
  collection: EntityCollection<EmbeddingEntity>,
  entity_type: 'source' | 'block',
  vec: number[] | Float32Array,
  filter: SearchFilter = {},
  fetchMultiplier: number = 3,
): Promise<QueryMatch[]> {
  if (!vec || vec.length === 0) return [];
  const modelKey = collection.embed_model_key;
  if (!modelKey || modelKey === 'None') return [];

  const limit = Math.max(1, filter.limit ?? 50);
  const fetchLimit = Math.max(limit, limit * Math.max(1, fetchMultiplier));
  const conditions: string[] = [
    'em.model_key = ?',
    'e.entity_type = ?',
    'e.last_read_hash IS NOT NULL',
    'em.embed_hash = e.last_read_hash',
  ];
  const params: (string | number)[] = [modelKey, entity_type];

  const expectedDims = collection.embed_model_dims;
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
  if (filter.include?.length) {
    conditions.push(`e.entity_key IN (${filter.include.map(() => '?').join(',')})`);
    params.push(...filter.include);
  }
  if (filter.exclude?.length) {
    conditions.push(`e.entity_key NOT IN (${filter.exclude.map(() => '?').join(',')})`);
    params.push(...filter.exclude);
  }

  const SQL_FETCH_CAP = 2000;
  const rows = db.prepare(`
    SELECT em.entity_key, em.vec
    FROM entity_embeddings em
    JOIN entities e ON e.entity_key = em.entity_key
    WHERE ${conditions.join(' AND ')}
    LIMIT ${SQL_FETCH_CAP}
  `).all(...params) as unknown as NearestRow[];
  const queryF32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
  const minScore = filter.min_score;

  const scored = await processInChunks<NearestRow, QueryMatch>(
    rows,
    500,
    async (chunk) => {
      const chunkResults: QueryMatch[] = [];
      for (const row of chunk) {
        const candidateVec = blobToF32(row.vec);
        if (!candidateVec || candidateVec.length !== queryF32.length) continue;
        const score = cos_sim_f32(queryF32, candidateVec);
        if (minScore !== undefined && score < minScore) continue;
        chunkResults.push({ entity_key: row.entity_key, score });
      }
      return chunkResults;
    },
  );

  scored.sort((left, right) => right.score - left.score);
  return scored.slice(0, fetchLimit);
}
