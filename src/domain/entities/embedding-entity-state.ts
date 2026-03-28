import type { ConnectionResult, SearchFilter } from '../../types/entities';
import type { EmbeddingEntity } from './EmbeddingEntity';
import { hasEmbeddingDimMismatch } from './embedding-entity-meta';

export function isEntityUnembedded(entity: EmbeddingEntity): boolean {
  const current_vec = entity.vec;
  const read_hash = entity.read_hash;
  const active_hash = entity.active_embedding_meta?.hash;
  const expected_dims = entity.collection.embed_model_dims;
  const active_dims = entity.active_embedding_meta?.dims;

  if (!current_vec) {
    if (!read_hash) return true;
    if (!active_hash || active_hash !== read_hash) return true;
    if (
      typeof expected_dims === 'number' &&
      expected_dims > 0 &&
      typeof active_dims === 'number' &&
      active_dims > 0 &&
      active_dims !== expected_dims
    ) {
      return true;
    }
    return false;
  }

  if (hasEmbeddingDimMismatch(entity, current_vec)) return true;
  if (!read_hash) return true;
  if (!active_hash || active_hash !== read_hash) return true;
  return false;
}

export function entityHasEmbed(entity: EmbeddingEntity): boolean {
  if (entity.vec && entity.vec.length > 0) return true;
  const read_hash = entity.read_hash;
  const active_hash = entity.active_embedding_meta?.hash;
  return !!read_hash && !!active_hash && read_hash === active_hash;
}

export function evictEntityVector(entity: EmbeddingEntity): void {
  const model_key = entity.embed_model_key;
  if (entity.data.embeddings[model_key]) {
    entity.data.embeddings[model_key].vec = [];
  }
}

export function removeEntityEmbeddings(entity: EmbeddingEntity): void {
  entity.data.embeddings = {};
  if (entity.data.embedding_meta) {
    entity.data.embedding_meta = {};
  }
  delete entity.data.last_embed;
  entity._remove_all_embeddings = true;
  entity.queue_save();
}

export async function nearestEntities(
  entity: EmbeddingEntity,
  filter: SearchFilter = {},
): Promise<ConnectionResult[]> {
  await entity.collection.ensure_entity_vector(entity);
  if (!entity.vec) {
    throw new Error('Entity has no embedding vector');
  }

  return entity.collection.nearest(entity.vec, {
    ...filter,
    exclude: [...(filter.exclude || []), entity.key],
  });
}
