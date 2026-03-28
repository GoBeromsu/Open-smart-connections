import type { DatabaseSync, StatementSync } from 'node:sqlite';

import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityCollection } from './EntityCollection';
import { extractEntityCore, vecToBlob, withTransaction } from './node-sqlite-helpers';

export function executeNodeSqliteSaveBatch<T extends EmbeddingEntity>(
  db: DatabaseSync,
  collection: EntityCollection<T>,
  entity_type: 'source' | 'block',
  entities: T[],
  deletedKeys: string[],
  restoreDeletedKeys: boolean,
): void {
  const savedEntities: T[] = [];
  const deleteEmbeddingsStmt = db.prepare('DELETE FROM entity_embeddings WHERE entity_key = ?');
  const deleteEntityStmt = db.prepare('DELETE FROM entities WHERE entity_key = ?');
  const upsertEntityStmt = db.prepare(`
    INSERT OR REPLACE INTO entities (
      entity_key, entity_type, path, source_path,
      last_read_hash, last_read_size, last_read_mtime, text_len, extra
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
    withTransaction(db, () => {
      for (const key of deletedKeys) {
        deleteEmbeddingsStmt.run(key);
        deleteEntityStmt.run(key);
      }
      for (const entity of entities) {
        if (!entity.validate_save()) {
          entity._queue_save = false;
          continue;
        }
        upsertEntityWith(upsertEntityStmt, entity, entity_type);
        upsertEmbeddingWith(
          upsertEmbedStmt,
          updateEmbedHashStmt,
          removeAllEmbedStmt,
          entity,
        );
        savedEntities.push(entity);
      }
    });

    for (const entity of savedEntities) {
      entity._queue_save = false;
    }
  } catch (error) {
    if (restoreDeletedKeys && deletedKeys.length > 0) {
      collection.restore_deleted_keys(deletedKeys);
    }
    throw error;
  }
}

function upsertEntityWith(
  stmt: StatementSync,
  entity: EmbeddingEntity,
  entity_type: 'source' | 'block',
): void {
  const data = entity.data;
  const { source_path, text_len, extra } = extractEntityCore(data);
  const lastRead = data.last_read;

  stmt.run(
    entity.key,
    entity_type,
    data.path,
    source_path,
    lastRead?.hash ?? null,
    lastRead?.size ?? null,
    lastRead?.mtime ?? null,
    text_len,
    JSON.stringify(extra),
  );
}

function upsertEmbeddingWith(
  upsertStmt: StatementSync,
  updateHashStmt: StatementSync,
  removeAllStmt: StatementSync,
  entity: EmbeddingEntity,
): void {
  const entityWithFlags = entity as EmbeddingEntity & { _remove_all_embeddings?: boolean };
  if (entityWithFlags._remove_all_embeddings) {
    removeAllStmt.run(entity.key);
    entityWithFlags._remove_all_embeddings = false;
    return;
  }

  const modelKey = entity.embed_model_key;
  if (!modelKey || modelKey === 'None') return;
  const embedding = entity.data.embeddings?.[modelKey];
  const vec = embedding?.vec;
  const meta = entity.data.embedding_meta?.[modelKey];

  if (!vec || vec.length === 0) {
    if (!meta) return;
    updateHashStmt.run(meta.hash ?? null, meta.dims ?? null, meta.updated_at ?? Date.now(), entity.key, modelKey);
    return;
  }

  const embedHash = meta?.hash ?? entity.data.last_embed?.hash ?? entity.data.last_read?.hash ?? null;
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
