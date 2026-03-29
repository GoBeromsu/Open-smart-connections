/**
 * @file EmbeddingEntity.ts
 * @description Base entity facade with embedding support.
 */

import type {
  ConnectionResult,
  EntityData,
  EmbeddingModelMeta,
  SearchFilter,
} from '../../types/entities';
import type { EntityCollection } from './EntityCollection';
import {
  getEntityTokens,
  getEntityVector,
  setEntityTokens,
  setEntityVector,
} from './embedding-entity-embedding';
import {
  ensureEmbeddingMetaStore,
  initializeEmbeddingEntity,
  setActiveEmbeddingMeta,
  setEmbeddingHash,
} from './embedding-entity-meta';
import {
  entityHasEmbed,
  evictEntityVector,
  isEntityUnembedded,
  nearestEntities,
  removeEntityEmbeddings,
} from './embedding-entity-state';

export class EmbeddingEntity {
  key: string;
  data: EntityData;
  collection: EntityCollection<EmbeddingEntity>;
  _queue_embed = false;
  _queue_save = false;
  _embed_input: string | null = null;
  _remove_all_embeddings = false;

  constructor(
    collection: EntityCollection<EmbeddingEntity>,
    data: Partial<EntityData> = {},
    defaults?: EntityData,
  ) {
    this.collection = collection;
    this.data = defaults ?? this.get_defaults();
    Object.assign(this.data, data);
    this.key = this.get_key();
  }

  protected get_defaults(): EntityData {
    return { path: '', embeddings: {} };
  }

  init(): void {
    initializeEmbeddingEntity(this);
  }

  get_key(): string {
    return this.data.path || '';
  }

  queue_embed(): void {
    if (this.should_embed && this.is_unembedded) {
      this._queue_embed = true;
    }
  }

  queue_save(): void {
    this._queue_save = true;
  }

  get_embed_input(_content: string | null = null): Promise<void> {
    return Promise.resolve();
  }

  get embed_model_key(): string {
    return this.collection.embed_model_key;
  }

  get active_embedding_meta(): EmbeddingModelMeta | undefined {
    return this.data.embedding_meta?.[this.embed_model_key];
  }

  set_active_embedding_meta(meta: EmbeddingModelMeta): void {
    setActiveEmbeddingMeta(this, meta);
  }

  get vec(): number[] | Float32Array | null {
    return getEntityVector(this);
  }

  set vec(vec: number[] | Float32Array | null) {
    setEntityVector(this, vec);
  }

  get tokens(): number | undefined {
    return getEntityTokens(this);
  }

  set tokens(tokens: number | undefined) {
    setEntityTokens(this, tokens);
  }

  get read_hash(): string | undefined {
    return this.data.last_read?.hash;
  }

  set read_hash(hash: string) {
    if (!this.data.last_read) {
      this.data.last_read = { hash };
    } else {
      this.data.last_read.hash = hash;
    }
    this.queue_save();
  }

  get embed_hash(): string | undefined {
    return this.active_embedding_meta?.hash || this.data.last_embed?.hash;
  }

  set embed_hash(hash: string) {
    setEmbeddingHash(this, hash);
  }

  get path(): string {
    return this.data.path;
  }

  get size(): number {
    return 0;
  }

  get should_embed(): boolean {
    const min_chars = (this.collection.settings?.min_chars as number | undefined) || 300;
    return this.size > min_chars;
  }

  get is_unembedded(): boolean {
    return isEntityUnembedded(this);
  }

  has_embed(): boolean {
    return entityHasEmbed(this);
  }

  evictVec(): void {
    evictEntityVector(this);
  }

  remove_embeddings(): void {
    removeEntityEmbeddings(this);
  }

  async nearest(filter: SearchFilter = {}): Promise<ConnectionResult[]> {
    return nearestEntities(this, filter);
  }

  validate_save(): boolean {
    return !!this.key && !!this.data.path;
  }

  delete(): void {
    this.collection.delete(this.key);
  }

  protected ensure_embedding_meta_store(): Record<string, EmbeddingModelMeta> {
    return ensureEmbeddingMetaStore(this);
  }
}
