import { describe, expect, it, vi } from 'vitest';
import { VaultFileDataAdapter } from '../src/domain/entities/vault-file-data-adapter';
import type { EntityData } from '../src/types/entities';

function makeVaultAdapter() {
  const files = new Map<string, string>();
  return {
    files,
    exists: vi.fn(async (path: string) => files.has(path)),
    read: vi.fn(async (path: string) => files.get(path) ?? ''),
    write: vi.fn(async (path: string, data: string) => {
      files.set(path, data);
    }),
    mkdir: vi.fn(async () => {}),
  };
}

function makeCollection(overrides: Record<string, unknown> = {}) {
  const entities: any[] = [];
  const byKey = new Map<string, any>();
  const deleted = new Set<string>();
  const collection = {
    embed_model_key: 'test-model',
    embed_model_dims: 2,
    settings: {},
    get all() {
      return entities;
    },
    get save_queue() {
      return entities.filter((entity) => entity._queue_save);
    },
    get(key: string) {
      return byKey.get(key);
    },
    consume_deleted_keys() {
      const keys = Array.from(deleted);
      deleted.clear();
      return keys;
    },
    restore_deleted_keys(keys: string[]) {
      keys.forEach((key) => deleted.add(key));
    },
    create_or_update: vi.fn((data: Partial<EntityData>) => {
      const key = String(data.path ?? '');
      const existing = byKey.get(key);
      if (existing) {
        Object.assign(existing.data, data);
        return existing;
      }
      const entity = makeEntity(key, data.embeddings?.['test-model']?.vec ?? null);
      entity.data = { ...entity.data, ...data } as EntityData;
      entity.is_unembedded = !entity.data.embeddings?.['test-model'];
      entity._queue_save = true;
      entities.push(entity);
      byKey.set(key, entity);
      return entity;
    }),
    ...overrides,
  };
  return collection as any;
}

function makeEntity(path: string, vec: number[] | Float32Array | null) {
  const embeddings: Record<string, any> = {};
  const embeddingMeta: Record<string, any> = {};
  if (vec) {
    embeddings['test-model'] = { vec, tokens: 2 };
    embeddingMeta['test-model'] = { hash: `hash:${path}`, dims: 2, updated_at: 123 };
  }
  return {
    key: path,
    data: {
      path,
      embeddings,
      embedding_meta: embeddingMeta,
      last_read: { hash: `hash:${path}`, size: 2, mtime: 123 },
    } as EntityData,
    _queue_save: true,
    _queue_embed: false,
    _remove_all_embeddings: false,
    is_unembedded: !vec,
    embed_model_key: 'test-model',
    validate_save: () => true,
  };
}

describe('VaultFileDataAdapter', () => {
  it('persists entities through vault adapter files and reloads vectors', async () => {
    const vaultAdapter = makeVaultAdapter();
    const collection = makeCollection();
    const entity = makeEntity('note.md#h1', [1, 0]);
    collection.create_or_update(entity.data);
    collection.all[0]._queue_save = true;

    const adapter = new VaultFileDataAdapter(collection, 'smart_blocks');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
    await adapter.save();

    expect(vaultAdapter.write).toHaveBeenCalledWith(
      '.obsidian/plugins/open-connections/open-connections.block.json',
      expect.any(String),
    );
    expect(collection.all[0]._queue_save).toBe(false);

    const reloadedCollection = makeCollection();
    const reloadedAdapter = new VaultFileDataAdapter(reloadedCollection, 'smart_blocks');
    reloadedAdapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
    await reloadedAdapter.load();

    expect(reloadedCollection.create_or_update).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'note.md#h1' }),
    );
    const loaded = await reloadedAdapter.load_entity_vector('note.md#h1', 'test-model');
    expect(Array.from(loaded.vec ?? [])).toEqual([1, 0]);
  });

  it('queries nearest vectors and removes deleted keys', async () => {
    const vaultAdapter = makeVaultAdapter();
    const collection = makeCollection();
    collection.create_or_update(makeEntity('a.md#h1', [1, 0]).data);
    collection.create_or_update(makeEntity('b.md#h1', [0, 1]).data);
    collection.all.forEach((entity: any) => {
      entity._queue_save = true;
    });

    const adapter = new VaultFileDataAdapter(collection, 'smart_blocks');
    adapter.initVaultContext(vaultAdapter, '.obsidian', 'open-connections');
    await adapter.save();

    let results = await adapter.query_nearest([1, 0], { limit: 2 });
    expect(results.map((result) => result.entity_key)).toEqual(['a.md#h1', 'b.md#h1']);

    collection.all.splice(0, 1);
    await adapter.save_batch([], ['a.md#h1']);
    results = await adapter.query_nearest([1, 0], { limit: 2 });
    expect(results.map((result) => result.entity_key)).toEqual(['b.md#h1']);
  });
});
