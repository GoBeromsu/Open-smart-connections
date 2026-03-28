import type { EmbeddingData } from '../../types/entities';
import type { EmbeddingEntity } from './EmbeddingEntity';

function getEmbeddingData(entity: EmbeddingEntity): EmbeddingData {
  const existing = entity.data.embeddings[entity.embed_model_key];
  if (existing) {
    return existing;
  }
  const created: EmbeddingData = { vec: [] };
  entity.data.embeddings[entity.embed_model_key] = created;
  return created;
}

export function getEntityVector(entity: EmbeddingEntity): number[] | Float32Array | null {
  const vec = getEmbeddingData(entity).vec;
  return vec && vec.length > 0 ? vec : null;
}

export function setEntityVector(
  entity: EmbeddingEntity,
  vec: number[] | Float32Array | null,
): void {
  if (vec === null) {
    const embedding = entity.data.embeddings[entity.embed_model_key];
    if (embedding) {
      embedding.vec = [];
    }
  } else {
    getEmbeddingData(entity).vec = vec;
    entity._queue_embed = false;
    entity._remove_all_embeddings = false;
  }
  entity._embed_input = null;
  entity.queue_save();
}

export function getEntityTokens(entity: EmbeddingEntity): number | undefined {
  return getEmbeddingData(entity).tokens;
}

export function setEntityTokens(
  entity: EmbeddingEntity,
  tokens: number | undefined,
): void {
  if (tokens !== undefined) {
    getEmbeddingData(entity).tokens = tokens;
    entity.queue_save();
  }
}
