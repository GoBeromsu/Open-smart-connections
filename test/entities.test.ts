/**
 * @file entities.test.ts
 * @description Tests for entity classes and collections
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EmbeddingEntity } from '../src/domain/entities/EmbeddingEntity';
import { EntityCollection } from '../src/domain/entities/EntityCollection';
import { getEmbedAdapterSettings } from '../src/ui/embedding/collection-manager';
import type { EntityData } from '../src/types/entities';

describe('EmbeddingEntity', () => {
  let mockCollection: EntityCollection<any>;

  beforeEach(() => {
    mockCollection = {
      embed_model_key: 'test-model',
      settings: { min_chars: 300 },
      delete: () => {},
    } as any;
  });

  it('should create an entity with default data', () => {
    const entity = new EmbeddingEntity(mockCollection);

    expect(entity.data).toBeDefined();
    expect(entity.data.path).toBe('');
    expect(entity.data.embeddings).toEqual({});
  });

  it('should create an entity with provided data', () => {
    const data: Partial<EntityData> = {
      path: 'test.md',
      embeddings: {
        'test-model': { vec: [1, 2, 3] },
      },
    };

    const entity = new EmbeddingEntity(mockCollection, data);

    expect(entity.data.path).toBe('test.md');
    expect(entity.key).toBe('test.md');
  });

  it('should get and set vector correctly', () => {
    const entity = new EmbeddingEntity(mockCollection, { path: 'test.md' });

    expect(entity.vec).toBeNull();

    entity.vec = [1, 2, 3];

    expect(entity.vec).toEqual([1, 2, 3]);
    expect(entity.data.embeddings['test-model'].vec).toEqual([1, 2, 3]);
  });

  it('should maintain embeddings in correct format', () => {
    const entity = new EmbeddingEntity(mockCollection, { path: 'test.md' });

    entity.vec = [0.1, 0.2, 0.3];
    entity.tokens = 100;

    // Verify format: data.embeddings[model_key] = { vec, tokens }
    expect(entity.data.embeddings['test-model']).toEqual({
      vec: [0.1, 0.2, 0.3],
      tokens: 100,
    });
  });

  it('should queue embed when vec is null', () => {
    const entity = new EmbeddingEntity(mockCollection, { path: 'test.md' });
    entity._queue_embed = false;

    entity.init();

    expect(entity._queue_embed).toBe(false); // should_embed is false because size is 0
  });

  it('should clear vector and queue embed when dimensions mismatch active model', () => {
    const mismatchCollection = {
      embed_model_key: 'test-model',
      embed_model_dims: 3,
      settings: { min_chars: 10 },
      delete: () => {},
    } as any;

    const entity = new EmbeddingEntity(mismatchCollection, {
      path: 'test.md',
      embeddings: {
        'test-model': { vec: [1, 2] },
      },
    });

    Object.defineProperty(entity, 'size', { get: () => 500 });
    entity.init();

    expect(entity.vec).toBeNull();
    expect(entity._queue_embed).toBe(true);
  });

  it('should become unembedded after dimensions are synced later and queue on sweep', () => {
    const lateSyncCollection = {
      embed_model_key: 'test-model',
      settings: { min_chars: 10 },
      delete: () => {},
    } as any;

    const entity = new EmbeddingEntity(lateSyncCollection, {
      path: 'late-sync.md',
      embeddings: {
        'test-model': { vec: [1, 2] },
      },
    });

    Object.defineProperty(entity, 'size', { get: () => 500 });
    entity.read_hash = 'hash';
    entity.embed_hash = 'hash';

    entity.init();
    expect(entity._queue_embed).toBe(false);
    expect(entity.is_unembedded).toBe(false);

    lateSyncCollection.embed_model_dims = 3;
    expect(entity.is_unembedded).toBe(true);

    entity.queue_embed();
    expect(entity._queue_embed).toBe(true);
  });

  it('should preserve old model embeddings on init for model-specific cache reuse', () => {
    const entity = new EmbeddingEntity(mockCollection, {
      path: 'test.md',
      embeddings: {
        'test-model': { vec: [1, 2, 3] },
        'old-model': { vec: [4, 5, 6] },
      },
    });

    entity.init();

    expect(entity.data.embeddings['test-model']).toBeDefined();
    expect(entity.data.embeddings['old-model']).toBeDefined();
  });

  it('should handle read and embed hashes', () => {
    const entity = new EmbeddingEntity(mockCollection, { path: 'test.md' });

    entity.read_hash = 'hash123';
    entity.embed_hash = 'hash456';

    expect(entity.read_hash).toBe('hash123');
    expect(entity.embed_hash).toBe('hash456');
    expect(entity.data.last_read?.hash).toBe('hash123');
    expect(entity.data.last_embed?.hash).toBe('hash456');
    expect(entity.data.embedding_meta?.['test-model']?.hash).toBe('hash456');
  });

  it('should treat active-model vector without embedding_meta as stale in safe mode', () => {
    const entity = new EmbeddingEntity(mockCollection, {
      path: 'safe-mode.md',
      embeddings: {
        'test-model': { vec: [1, 2, 3] },
      },
      last_read: { hash: 'same-hash' },
      last_embed: { hash: 'same-hash' },
    });

    expect(entity.vec).toEqual([1, 2, 3]);
    expect(entity.data.embedding_meta).toBeUndefined();
    expect(entity.is_unembedded).toBe(true);
  });

  it('should detect when entity is unembedded', () => {
    const entity = new EmbeddingEntity(mockCollection, { path: 'test.md' });

    // No vector
    expect(entity.is_unembedded).toBe(true);

    // Has vector but no hash
    entity.vec = [1, 2, 3];
    expect(entity.is_unembedded).toBe(true);

    // Has vector and matching hashes
    entity.read_hash = 'hash123';
    entity.embed_hash = 'hash123';
    expect(entity.is_unembedded).toBe(false);

    // Hashes don't match
    entity.read_hash = 'hash456';
    expect(entity.is_unembedded).toBe(true);

    // Vector dimensions don't match active model
    (mockCollection as any).embed_model_dims = 2;
    entity.read_hash = 'hash123';
    entity.embed_hash = 'hash123';
    expect(entity.is_unembedded).toBe(true);
  });

  it('should check if entity has embedding', () => {
    const entity = new EmbeddingEntity(mockCollection, { path: 'test.md' });

    expect(entity.has_embed()).toBe(false);

    entity.vec = [1, 2, 3];
    expect(entity.has_embed()).toBe(true);

    entity.vec = null;
    expect(entity.has_embed()).toBe(false);
  });

  it('should remove all embeddings', () => {
    const entity = new EmbeddingEntity(mockCollection, {
      path: 'test.md',
      embeddings: {
        'test-model': { vec: [1, 2, 3] },
      },
      embedding_meta: {
        'test-model': { hash: 'hash123' },
      },
    });

    entity.remove_embeddings();

    expect(entity.data.embeddings).toEqual({});
    expect(entity.data.embedding_meta).toEqual({});
    expect(entity.data.last_embed).toBeUndefined();
    expect(entity._queue_save).toBe(true);
  });

  it('should validate save correctly', () => {
    const entity1 = new EmbeddingEntity(mockCollection, { path: 'test.md' });
    expect(entity1.validate_save()).toBe(true);

    const entity2 = new EmbeddingEntity(mockCollection, { path: '' });
    expect(entity2.validate_save()).toBe(false);
  });

  it('should queue save when vector is set', () => {
    const entity = new EmbeddingEntity(mockCollection, { path: 'test.md' });
    entity._queue_save = false;

    entity.vec = [1, 2, 3];

    expect(entity._queue_save).toBe(true);
  });

  it('should clear queue_embed when vector is set', () => {
    const entity = new EmbeddingEntity(mockCollection, { path: 'test.md' });
    entity._queue_embed = true;

    entity.vec = [1, 2, 3];

    expect(entity._queue_embed).toBe(false);
  });
});

// Concrete collection for testing
class TestCollection extends EntityCollection<EmbeddingEntity> {
  get_item_type() {
    return EmbeddingEntity;
  }
}

describe('EntityCollection', () => {
  let collection: TestCollection;

  beforeEach(() => {
    collection = new TestCollection(
      '/test/data',
      { min_chars: 300 },
      'test-model'
    );
  });

  it('should create collection with config', () => {
    expect(collection.embed_model_key).toBe('test-model');
    expect(collection.data_dir).toBe('/test/data');
  });

  it('should create and store entities', () => {
    const data: EntityData = {
      path: 'test.md',
      embeddings: {
        'test-model': { vec: [1, 2, 3] },
      },
    };

    const entity = collection.create_or_update(data);

    expect(entity.key).toBe('test.md');
    expect(collection.get('test.md')).toBe(entity);
    expect(collection.size).toBe(1);
  });

  it('should update existing entity', () => {
    const data1: EntityData = {
      path: 'test.md',
      embeddings: {
        'test-model': { vec: [1, 2, 3] },
      },
    };

    const entity1 = collection.create_or_update(data1);

    const data2: EntityData = {
      path: 'test.md',
      embeddings: {
        'test-model': { vec: [4, 5, 6] },
      },
    };

    const entity2 = collection.create_or_update(data2);

    expect(entity1).toBe(entity2); // Same entity updated
    expect(entity2.vec).toEqual([4, 5, 6]);
    expect(collection.size).toBe(1);
  });

  it('should delete entities', () => {
    const data: EntityData = {
      path: 'test.md',
      embeddings: {},
    };

    collection.create_or_update(data);
    expect(collection.size).toBe(1);

    collection.delete('test.md');
    expect(collection.size).toBe(0);
    expect(collection.get('test.md')).toBeUndefined();
  });

  it('should get all entities', () => {
    collection.create_or_update({ path: 'a.md', embeddings: {} });
    collection.create_or_update({ path: 'b.md', embeddings: {} });
    collection.create_or_update({ path: 'c.md', embeddings: {} });

    const all = collection.all;
    expect(all).toHaveLength(3);
  });

  it('should manage save queue', () => {
    const entity1 = collection.create_or_update({ path: 'a.md', embeddings: {} });
    const entity2 = collection.create_or_update({ path: 'b.md', embeddings: {} });

    entity1._queue_save = true;
    entity2._queue_save = false;

    const queue = collection.save_queue;
    expect(queue).toHaveLength(1);
    expect(queue[0]).toBe(entity1);
  });

  it('should filter entities by predicate', () => {
    collection.create_or_update({
      path: 'notes/a.md',
      embeddings: { 'test-model': { vec: [1, 2, 3] } },
    });
    collection.create_or_update({
      path: 'archive/b.md',
      embeddings: { 'test-model': { vec: [4, 5, 6] } },
    });
    collection.create_or_update({
      path: 'notes/c.md',
      embeddings: {},
    });

    const notesWithVec = collection.all.filter(
      (entity) => entity.key.startsWith('notes/') && entity.has_embed()
    );

    expect(notesWithVec).toHaveLength(1);
    expect(notesWithVec[0].key).toBe('notes/a.md');
  });
});

describe('getEmbedAdapterSettings', () => {
  it('should extract adapter-specific settings', () => {
    const settings = {
      adapter: 'transformers',
      transformers: { model_key: 'TaylorAI/bge-micro-v2', legacy_transformers: false },
    };
    const result = getEmbedAdapterSettings(settings);
    expect(result.model_key).toBe('TaylorAI/bge-micro-v2');
  });

  it('should return empty object when no adapter', () => {
    expect(getEmbedAdapterSettings(undefined)).toEqual({});
    expect(getEmbedAdapterSettings({})).toEqual({});
    expect(getEmbedAdapterSettings({ adapter: '' })).toEqual({});
  });

  it('should return empty object when adapter settings missing', () => {
    const settings = { adapter: 'transformers' };
    expect(getEmbedAdapterSettings(settings)).toEqual({});
  });

  it('should resolve model_key for upstage adapter', () => {
    const settings = {
      adapter: 'upstage',
      upstage: { model_key: 'embedding-passage', api_key: 'test-key' },
    };
    const result = getEmbedAdapterSettings(settings);
    expect(result.model_key).toBe('embedding-passage');
  });

  it('should prevent None model key when settings are configured', () => {
    // Simulates the fallback chain in initCollections
    const adapterSettings = getEmbedAdapterSettings({
      adapter: 'transformers',
      transformers: { model_key: 'TaylorAI/bge-micro-v2' },
    });
    const pluginEmbedModelKey = undefined; // Phase 1: embed_model not loaded yet
    const modelKey = pluginEmbedModelKey || adapterSettings.model_key || 'None';
    expect(modelKey).toBe('TaylorAI/bge-micro-v2');
    expect(modelKey).not.toBe('None');
  });
});
