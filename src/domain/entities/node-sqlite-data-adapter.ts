/**
 * @file node-sqlite-data-adapter.ts
 * @description Public Node SQLite adapter facade.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityCollection } from './EntityCollection';
import type { EmbeddingModelMeta, SearchFilter } from '../../types/entities';
import { getEntityType } from './node-sqlite-helpers';
import { initNodeSqliteDatabase, initNodeSqliteDatabaseAtPath } from './node-sqlite-registry';
import { loadNodeSqliteEntities, loadNodeSqliteEntityVector, loadVectorIndexRows, queryNodeSqliteNearest } from './node-sqlite-read';
import { FlatVectorIndex } from '../flat-vector-index';
import { executeNodeSqliteSaveBatch } from './node-sqlite-save';
import type { QueryMatch } from './node-sqlite-types';

export { closeNodeSqliteDatabases } from './node-sqlite-registry';

export class NodeSqliteDataAdapter<T extends EmbeddingEntity> {
  collection: EntityCollection<T>;
  collection_key: string;
  storage_namespace: string;
  entity_type: 'source' | 'block';

  private _db: DatabaseSync | null = null;
  private _closed = false;
  private _vectorIndex: FlatVectorIndex | null = null;
  private static readonly MAX_VECTOR_INDEX_BYTES = 512 * 1024 * 1024;

  constructor(
    collection: EntityCollection<T>,
    collection_key: string,
    storage_namespace: string,
  ) {
    this.collection = collection;
    this.collection_key = collection_key;
    this.storage_namespace = storage_namespace;
    this.entity_type = getEntityType(collection_key);
  }

  initVaultContext(vaultAdapter: unknown, configDir: string, pluginId: string): void {
    this._db = initNodeSqliteDatabase(vaultAdapter, configDir, pluginId);
    this._closed = false;
  }

  initDbPath(absoluteDbPath: string): void {
    this._db = initNodeSqliteDatabaseAtPath(absoluteDbPath);
    this._closed = false;
  }

  close(): void {
    if (!this._closed) {
      this._db?.close();
      this._closed = true;
    }
  }

  load(): void {
    loadNodeSqliteEntities(this.requireDb(), this.collection, this.entity_type);
    this.rebuildVectorIndex();
  }

  rebuildVectorIndex(): void {
    const modelKey = this.collection.embed_model_key;
    const dims = this.collection.embed_model_dims;
    if (!modelKey || modelKey === 'None' || !dims) {
      this._vectorIndex = null;
      return;
    }
    const approximateBytes = this.collection.size * dims * Float32Array.BYTES_PER_ELEMENT;
    if (approximateBytes > NodeSqliteDataAdapter.MAX_VECTOR_INDEX_BYTES) {
      this._vectorIndex = null;
      return;
    }
    const rows = loadVectorIndexRows(this.requireDb(), modelKey, this.entity_type, dims);
    const index = new FlatVectorIndex();
    index.load(rows, dims);
    this._vectorIndex = index;
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
    try {
      return Promise.resolve(loadNodeSqliteEntityVector(this.requireDb(), entityKey, modelKey));
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async query_nearest(
    vec: number[] | Float32Array,
    filter: SearchFilter = {},
    fetchMultiplier: number = 3,
  ): Promise<QueryMatch[]> {
    if (this._vectorIndex && this._vectorIndex.size > 0) {
      const limit = Math.max(1, filter.limit ?? 50);
      const fetchLimit = Math.max(limit, limit * Math.max(1, fetchMultiplier));
      return this._vectorIndex.queryNearest(vec, filter, fetchLimit);
    }
    return queryNodeSqliteNearest(
      this.requireDb(),
      this.collection as unknown as EntityCollection<EmbeddingEntity>,
      this.entity_type,
      vec,
      filter,
      fetchMultiplier,
    );
  }

  private requireDb(): DatabaseSync {
    if (this._closed || !this._db) {
      throw new Error('[NodeSQLite] Database not initialized — call initVaultContext first');
    }
    return this._db;
  }

  private runSave(
    entities: T[],
    deletedKeys: string[],
    restoreDeletedKeys: boolean,
  ): Promise<void> {
    try {
      if (entities.length === 0 && deletedKeys.length === 0) return Promise.resolve();
      executeNodeSqliteSaveBatch(
        this.requireDb(),
        this.collection,
        this.entity_type,
        entities,
        deletedKeys,
        restoreDeletedKeys,
      );
      if (this._vectorIndex) {
        for (const entity of entities) {
          if (entity.vec && entity.vec.length > 0) {
            const f32 = entity.vec instanceof Float32Array ? entity.vec : new Float32Array(entity.vec);
            this._vectorIndex.upsert(entity.key, f32);
          }
        }
        for (const key of deletedKeys) {
          this._vectorIndex.remove(key);
        }
      }
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
