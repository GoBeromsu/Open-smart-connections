/**
 * @file node-sqlite-data-adapter.ts
 * @description Public Node SQLite adapter facade.
 */

import type { DatabaseSync } from 'node:sqlite';

import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityCollection } from './EntityCollection';
import type { EmbeddingModelMeta, SearchFilter } from '../../types/entities';
import { getEntityType } from './node-sqlite-helpers';
import { initNodeSqliteDatabase } from './node-sqlite-registry';
import { loadNodeSqliteEntities, loadNodeSqliteEntityVector, queryNodeSqliteNearest } from './node-sqlite-read';
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

  close(): void {
    if (!this._closed) {
      this._db?.close();
      this._closed = true;
    }
  }

  load(): void {
    loadNodeSqliteEntities(this.requireDb(), this.collection, this.entity_type);
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
      return Promise.resolve();
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }
}
