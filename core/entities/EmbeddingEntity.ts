/**
 * @file EmbeddingEntity.ts
 * @description Base entity class with embedding support (ported from smart_entity.js)
 */

import type {
  EntityData,
  EmbeddingData,
  EmbeddingModelMeta,
  ConnectionResult,
  SearchFilter,
} from '../types/entities';
import type { EntityCollection } from './EntityCollection';
import { create_hash } from '../utils';

/**
 * Base entity class with embedding support
 * Ported from lib/entities/smart_entity.js
 */
export class EmbeddingEntity {
  /** Entity key (path for sources, path#heading for blocks) */
  key: string;

  /** Entity data (persisted via storage adapter) */
  data: EntityData;

  /** Parent collection */
  collection: EntityCollection<any>;

  /** Whether entity needs embedding */
  _queue_embed: boolean = false;

  /** Whether entity needs saving */
  _queue_save: boolean = false;

  /** Cached embed input text */
  _embed_input: string | null = null;

  /** Flag for deleting all persisted embeddings for this entity */
  _remove_all_embeddings: boolean = false;

  constructor(collection: EntityCollection<any>, data: Partial<EntityData> = {}) {
    this.collection = collection;
    this.data = this.get_defaults();

    // Merge provided data
    Object.assign(this.data, data);

    // Set key from data
    this.key = this.get_key();
  }

  /**
   * Get default data structure
   * Override in subclasses
   */
  protected get_defaults(): EntityData {
    return {
      path: '',
      embeddings: {},
    };
  }

  /**
   * Initialize entity after creation/load
   * Checks if embedding is valid, queues embed if needed
   */
  init(): void {
    const current_vec = this.vec;

    // Drop in-memory vec when model dimensions mismatch.
    if (current_vec && this.has_dim_mismatch(current_vec)) {
      this.vec = null;
    }

    // Queue only when the active-model embedding is actually stale/missing.
    if (this.is_unembedded) {
      this.queue_embed();
    }
  }

  private has_dim_mismatch(vec: number[] | null): boolean {
    const expected_dims = (this.collection as any).embed_model_dims;
    return (
      typeof expected_dims === 'number' &&
      expected_dims > 0 &&
      !!vec &&
      vec.length !== expected_dims
    );
  }

  private ensure_embedding_meta_store(): Record<string, EmbeddingModelMeta> {
    if (!this.data.embedding_meta || typeof this.data.embedding_meta !== 'object') {
      this.data.embedding_meta = {};
    }
    return this.data.embedding_meta;
  }

  /**
   * Get entity key (derived from path)
   */
  get_key(): string {
    return this.data.path || '';
  }

  /**
   * Queue entity for embedding
   */
  queue_embed(): void {
    if (this.should_embed && this.is_unembedded) {
      this._queue_embed = true;
    }
  }

  /**
   * Queue entity for saving
   */
  queue_save(): void {
    this._queue_save = true;
  }

  /**
   * Get embed input text (to be overridden in subclasses)
   */
  async get_embed_input(content: string | null = null): Promise<void> {
    // Override in subclass
  }

  /**
   * Get embedding data for current model
   */
  protected get embedding_data(): EmbeddingData {
    if (!this.data.embeddings[this.embed_model_key]) {
      this.data.embeddings[this.embed_model_key] = { vec: [] };
    }
    return this.data.embeddings[this.embed_model_key];
  }

  // Getters and setters

  /**
   * Get embedding model key from collection
   */
  get embed_model_key(): string {
    return this.collection.embed_model_key;
  }

  /**
   * Get metadata for the currently active embedding model.
   */
  get active_embedding_meta(): EmbeddingModelMeta | undefined {
    return this.data.embedding_meta?.[this.embed_model_key];
  }

  /**
   * Merge metadata for the active embedding model.
   */
  set_active_embedding_meta(meta: EmbeddingModelMeta): void {
    const store = this.ensure_embedding_meta_store();
    const current = store[this.embed_model_key];
    store[this.embed_model_key] = { ...(current || {}), ...meta };
    this.queue_save();
  }

  /**
   * Get current embedding vector
   * CRITICAL: Format is data.embeddings[model_key].vec
   */
  get vec(): number[] | null {
    const vec = this.embedding_data.vec;
    return (vec && vec.length > 0) ? vec : null;
  }

  /**
   * Set embedding vector
   * CRITICAL: Must maintain data.embeddings[model_key] = { vec, tokens } format
   */
  set vec(vec: number[] | null) {
    if (vec === null) {
      if (this.data.embeddings[this.embed_model_key]) {
        this.data.embeddings[this.embed_model_key].vec = [];
      }
    } else {
      this.embedding_data.vec = vec;
      this._queue_embed = false;  // Only clear when setting real vector
      this._remove_all_embeddings = false;
    }
    this._embed_input = null;
    this.queue_save();
  }

  /**
   * Get token count
   */
  get tokens(): number | undefined {
    return this.embedding_data.tokens;
  }

  /**
   * Set token count
   */
  set tokens(tokens: number | undefined) {
    if (tokens !== undefined) {
      this.embedding_data.tokens = tokens;
      this.queue_save();
    }
  }

  /**
   * Get read hash
   */
  get read_hash(): string | undefined {
    return this.data.last_read?.hash;
  }

  /**
   * Set read hash
   */
  set read_hash(hash: string) {
    if (!this.data.last_read) {
      this.data.last_read = { hash };
    } else {
      this.data.last_read.hash = hash;
    }
    this.queue_save();
  }

  /**
   * Get embed hash
   */
  get embed_hash(): string | undefined {
    return this.active_embedding_meta?.hash || this.data.last_embed?.hash;
  }

  /**
   * Set embed hash
   */
  set embed_hash(hash: string) {
    if (!this.data.last_embed) {
      this.data.last_embed = { hash };
    } else {
      this.data.last_embed.hash = hash;
    }
    const metaStore = this.ensure_embedding_meta_store();
    const currentMeta = metaStore[this.embed_model_key];
    metaStore[this.embed_model_key] = {
      ...(currentMeta || {}),
      hash,
      size: this.data.last_read?.size ?? currentMeta?.size,
      mtime: this.data.last_read?.mtime ?? currentMeta?.mtime,
      updated_at: Date.now(),
    };
  }

  /**
   * Get entity path
   */
  get path(): string {
    return this.data.path;
  }

  /**
   * Get embed link (for Obsidian)
   */
  get embed_link(): string {
    return `![[${this.path}]]`;
  }

  /**
   * Get size (to be overridden)
   */
  get size(): number {
    return 0;
  }

  /**
   * Check if entity should be embedded
   * Default: embed if size > min_chars setting
   */
  get should_embed(): boolean {
    const min_chars = this.collection.settings?.min_chars || 300;
    return this.size > min_chars;
  }

  /**
   * Check if entity is unembedded or needs re-embedding
   */
  get is_unembedded(): boolean {
    const current_vec = this.vec;
    const read_hash = this.read_hash;
    const active_hash = this.active_embedding_meta?.hash;
    const expected_dims = (this.collection as any).embed_model_dims;
    const active_dims = this.active_embedding_meta?.dims;

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

    if (this.has_dim_mismatch(current_vec)) return true;
    if (!read_hash) return true;
    if (!active_hash || active_hash !== read_hash) return true;
    return false;
  }

  /**
   * Check if entity has valid embedding
   */
  has_embed(): boolean {
    if (this.vec && this.vec.length > 0) return true;
    const read_hash = this.read_hash;
    const active_hash = this.active_embedding_meta?.hash;
    return !!read_hash && !!active_hash && read_hash === active_hash;
  }

  /**
   * Remove all embeddings
   */
  remove_embeddings(): void {
    this.data.embeddings = {};
    if (this.data.embedding_meta) {
      this.data.embedding_meta = {};
    }
    delete this.data.last_embed;
    this._remove_all_embeddings = true;
    this.queue_save();
  }

  /**
   * Find nearest entities to this one
   * Delegates to collection's search function
   */
  async nearest(filter: SearchFilter = {}): Promise<ConnectionResult[]> {
    if (!this.vec) {
      throw new Error('Entity has no embedding vector');
    }

    // Use collection's search function
    return await this.collection.nearest(this.vec, {
      ...filter,
      exclude: [...(filter.exclude || []), this.key],
    });
  }

  /**
   * Validate entity before saving
   */
  validate_save(): boolean {
    return !!this.key && !!this.data.path;
  }

  /**
   * Delete entity
   */
  delete(): void {
    this.collection.delete(this.key);
  }
}
