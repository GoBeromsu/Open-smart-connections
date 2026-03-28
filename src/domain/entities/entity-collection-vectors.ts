import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityCollection } from './EntityCollection';

export async function ensureEntityVector<T extends EmbeddingEntity>(
  collection: EntityCollection<T>,
  entity: T,
): Promise<void> {
  if (entity.vec && entity.vec.length > 0) return;

  const model_key = collection.embed_model_key;
  if (!model_key || model_key === 'None') return;

  const loaded = await collection.data_adapter.load_entity_vector(entity.key, model_key);
  if (!loaded.vec || loaded.vec.length === 0) return;

  if (!entity.data.embeddings[model_key]) {
    entity.data.embeddings[model_key] = { vec: [] };
  }
  entity.data.embeddings[model_key].vec = loaded.vec;
  if (loaded.tokens !== undefined) {
    entity.data.embeddings[model_key].tokens = loaded.tokens;
  }

  if (loaded.meta) {
    if (!entity.data.embedding_meta || typeof entity.data.embedding_meta !== 'object') {
      entity.data.embedding_meta = {};
    }
    entity.data.embedding_meta[model_key] = {
      ...(entity.data.embedding_meta[model_key] || {}),
      ...loaded.meta,
    };
  }

  entity._queue_embed = false;
  entity._queue_save = false;
}
