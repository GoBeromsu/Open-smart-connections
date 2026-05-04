import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityCollection } from './EntityCollection';
import type { EmbeddingData, EmbeddingModelMeta, EntityData, SearchFilter } from '../../types/entities';
import type { QueryMatch } from './node-sqlite-types';
import { cos_sim_f32, processInChunks } from '../../utils';

type VaultFileAdapter = {
  exists?: (path: string) => Promise<boolean>;
  read?: (path: string) => Promise<string>;
  write?: (path: string, data: string) => Promise<void>;
  mkdir?: (path: string) => Promise<void>;
};

type StoredEntity = {
  entity_key: string;
  data: EntityData;
};

type StoredCollection = {
  version: 1;
  entity_type: 'source' | 'block';
  entities: StoredEntity[];
};

export class VaultFileDataAdapter<T extends EmbeddingEntity> {
  collection: EntityCollection<T>;
  collection_key: string;
  entity_type: 'source' | 'block';

  private vaultAdapter: VaultFileAdapter | null = null;
  private storagePath: string | null = null;
  private records = new Map<string, EntityData>();

  constructor(collection: EntityCollection<T>, collection_key: string) {
    this.collection = collection;
    this.collection_key = collection_key;
    this.entity_type = collection_key === 'smart_blocks' ? 'block' : 'source';
  }

  initVaultContext(vaultAdapter: unknown, configDir: string, pluginId: string): void {
    this.vaultAdapter = vaultAdapter as VaultFileAdapter;
    this.storagePath = `${configDir}/plugins/${pluginId}/${pluginId}.${this.entity_type}.json`;
  }

  close(): void {
    this.vaultAdapter = null;
  }

  async load(): Promise<void> {
    const adapter = this.requireVaultAdapter();
    const path = this.requireStoragePath();
    this.records.clear();

    if (!adapter.exists || !adapter.read || !(await adapter.exists(path))) {
      return;
    }

    const parsed = JSON.parse(await adapter.read(path)) as StoredCollection;
    for (const record of parsed.entities || []) {
      const data = deserializeEntityData(record.data);
      this.records.set(record.entity_key, cloneEntityData(data));
      const entity = this.collection.create_or_update(data);
      entity._queue_save = false;
      if (!entity.is_unembedded) {
        entity._queue_embed = false;
      }
    }
  }

  rebuildVectorIndex(): void {
    // File-backed storage queries directly over the in-memory collection.
  }

  save(): Promise<void> {
    return this.runSave([...this.collection.save_queue], this.collection.consume_deleted_keys(), true);
  }

  save_batch(entities: T[], deletedKeys: string[] = []): Promise<void> {
    return this.runSave([...entities], [...deletedKeys], false);
  }

  load_entity_vector(
    entityKey: string,
    modelKey: string,
  ): Promise<{ vec: Float32Array | null; tokens?: number; meta?: EmbeddingModelMeta }> {
    const data = this.records.get(entityKey) ?? this.collection.get(entityKey)?.data;
    const embedding = data?.embeddings?.[modelKey];
    const vec = embedding?.vec;
    return Promise.resolve({
      vec: vec && vec.length > 0 ? new Float32Array(vec) : null,
      tokens: embedding?.tokens,
      meta: data?.embedding_meta?.[modelKey],
    });
  }

  async query_nearest(
    vec: number[] | Float32Array,
    filter: SearchFilter = {},
    fetchMultiplier: number = 3,
  ): Promise<QueryMatch[]> {
    if (!vec || vec.length === 0) return [];
    const modelKey = this.collection.embed_model_key;
    if (!modelKey || modelKey === 'None') return [];

    const limit = Math.max(1, filter.limit ?? 50);
    const fetchLimit = Math.max(limit, limit * Math.max(1, fetchMultiplier));
    const queryF32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
    const expectedDims = this.collection.embed_model_dims;
    const minScore = filter.min_score;

    const scored = await processInChunks<EmbeddingEntity, QueryMatch>(
      this.collection.all,
      500,
      (chunk) => {
        const chunkResults: QueryMatch[] = [];
        for (const entity of chunk) {
          if (!matchesFilter(entity.key, filter)) continue;
          const candidate = entity.data.embeddings?.[modelKey]?.vec;
          if (!candidate || candidate.length !== queryF32.length) continue;
          if (expectedDims && candidate.length !== expectedDims) continue;
          const candidateF32 = candidate instanceof Float32Array ? candidate : new Float32Array(candidate);
          const score = cos_sim_f32(queryF32, candidateF32);
          if (minScore !== undefined && score < minScore) continue;
          chunkResults.push({ entity_key: entity.key, score });
        }
        return Promise.resolve(chunkResults);
      },
    );

    scored.sort((left, right) => right.score - left.score);
    return scored.slice(0, fetchLimit);
  }

  private async runSave(
    entities: T[],
    deletedKeys: string[],
    restoreDeletedKeys: boolean,
  ): Promise<void> {
    const savedEntities: T[] = [];
    try {
      for (const key of deletedKeys) {
        this.records.delete(key);
      }
      for (const entity of entities) {
        if (!entity.validate_save()) {
          entity._queue_save = false;
          continue;
        }
        const entityWithFlags = entity as T & { _remove_all_embeddings?: boolean };
        if (entityWithFlags._remove_all_embeddings) {
          entity.data.embeddings = {};
          entity.data.embedding_meta = {};
          entityWithFlags._remove_all_embeddings = false;
        }
        this.records.set(entity.key, cloneEntityData(entity.data));
        savedEntities.push(entity);
      }

      await this.writeStore();

      for (const entity of savedEntities) {
        entity._queue_save = false;
      }
    } catch (error) {
      if (restoreDeletedKeys && deletedKeys.length > 0) {
        this.collection.restore_deleted_keys(deletedKeys);
      }
      throw error;
    }
  }

  private async writeStore(): Promise<void> {
    const adapter = this.requireVaultAdapter();
    const path = this.requireStoragePath();
    const dir = path.split('/').slice(0, -1).join('/');
    if (adapter.mkdir && dir) {
      await adapter.mkdir(dir);
    }
    if (!adapter.write) {
      throw new Error('[VaultFileDataAdapter] vault adapter write() not available');
    }
    const store: StoredCollection = {
      version: 1,
      entity_type: this.entity_type,
      entities: Array.from(this.records.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([entity_key, data]) => ({ entity_key, data: serializeEntityData(data) })),
    };
    await adapter.write(path, JSON.stringify(store));
  }

  private requireVaultAdapter(): VaultFileAdapter {
    if (!this.vaultAdapter) {
      throw new Error('[VaultFileDataAdapter] Vault adapter not initialized');
    }
    return this.vaultAdapter;
  }

  private requireStoragePath(): string {
    if (!this.storagePath) {
      throw new Error('[VaultFileDataAdapter] Storage path not initialized');
    }
    return this.storagePath;
  }
}

function matchesFilter(key: string, filter: SearchFilter): boolean {
  if (filter.key_starts_with && !key.startsWith(filter.key_starts_with)) return false;
  if (filter.key_does_not_start_with && key.startsWith(filter.key_does_not_start_with)) return false;
  if (filter.include?.length && !filter.include.includes(key)) return false;
  if (filter.exclude?.length && filter.exclude.includes(key)) return false;
  return true;
}

function cloneEntityData(data: EntityData): EntityData {
  return deserializeEntityData(serializeEntityData(data));
}

function serializeEntityData(data: EntityData): EntityData {
  const copy = { ...data, embeddings: {} as Record<string, EmbeddingData> };
  for (const [modelKey, embedding] of Object.entries(data.embeddings || {})) {
    copy.embeddings[modelKey] = {
      ...embedding,
      vec: Array.from(embedding.vec || []),
    };
  }
  if (data.embedding_meta) {
    copy.embedding_meta = { ...data.embedding_meta };
  }
  return copy;
}

function deserializeEntityData(data: EntityData): EntityData {
  const copy = { ...data, embeddings: {} as Record<string, EmbeddingData> };
  for (const [modelKey, embedding] of Object.entries(data.embeddings || {})) {
    copy.embeddings[modelKey] = {
      ...embedding,
      vec: new Float32Array(embedding.vec || []),
    };
  }
  if (data.embedding_meta) {
    copy.embedding_meta = { ...data.embedding_meta };
  }
  return copy;
}
