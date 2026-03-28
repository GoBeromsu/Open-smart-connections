import type { EmbeddingModelMeta } from '../../types/entities';
import type { EmbeddingEntity } from './EmbeddingEntity';

export function hasEmbeddingDimMismatch(
  entity: EmbeddingEntity,
  vec: number[] | Float32Array | null,
): boolean {
  const expected_dims = entity.collection.embed_model_dims;
  return (
    typeof expected_dims === 'number' &&
    expected_dims > 0 &&
    !!vec &&
    vec.length !== expected_dims
  );
}

export function ensureEmbeddingMetaStore(
  entity: EmbeddingEntity,
): Record<string, EmbeddingModelMeta> {
  if (!entity.data.embedding_meta || typeof entity.data.embedding_meta !== 'object') {
    entity.data.embedding_meta = {};
  }
  return entity.data.embedding_meta;
}

export function initializeEmbeddingEntity(entity: EmbeddingEntity): void {
  const current_vec = entity.vec;
  if (current_vec && hasEmbeddingDimMismatch(entity, current_vec)) {
    entity.vec = null;
  }
  if (entity.is_unembedded) {
    entity.queue_embed();
  }
}

export function setActiveEmbeddingMeta(
  entity: EmbeddingEntity,
  meta: EmbeddingModelMeta,
): void {
  const store = ensureEmbeddingMetaStore(entity);
  const current = store[entity.embed_model_key];
  store[entity.embed_model_key] = { ...(current || {}), ...meta };
  entity.queue_save();
}

export function setEmbeddingHash(entity: EmbeddingEntity, hash: string): void {
  if (!entity.data.last_embed) {
    entity.data.last_embed = { hash };
  } else {
    entity.data.last_embed.hash = hash;
  }

  const metaStore = ensureEmbeddingMetaStore(entity);
  const currentMeta = metaStore[entity.embed_model_key];
  metaStore[entity.embed_model_key] = {
    ...(currentMeta || {}),
    hash,
    size: entity.data.last_read?.size ?? currentMeta?.size,
    mtime: entity.data.last_read?.mtime ?? currentMeta?.mtime,
    updated_at: Date.now(),
  };
}
