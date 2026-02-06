/**
 * @file EmbeddingEntity.ts
 * @description Base entity class with embedding support (ported from smart_entity.js)
 */

import type { EntityData, EmbeddingData, ConnectionResult, SearchFilter } from '../types/entities';
import type { EntityCollection } from './EntityCollection';
import { create_hash } from '../utils';

/**
 * Base entity class with embedding support
 * Ported from lib/entities/smart_entity.js
 */
export class EmbeddingEntity {
  /** Entity key (path for sources, path#heading for blocks) */
  key: string;

  /** Entity data (persisted to AJSON) */
  data: EntityData;

  /** Parent collection */
  collection: EntityCollection<any>;

  /** Whether entity needs embedding */
  _queue_embed: boolean = false;

  /** Whether entity needs saving */
  _queue_save: boolean = false;

  /** Cached embed input text */
  _embed_input: string | null = null;

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
    // Check if vector exists and matches model dimensions
    if (!this.vec || !this.vec.length) {
      this.vec = null;
      this.queue_embed();
    }

    // Only keep active model embeddings
    if (this.data.embeddings) {
      Object.keys(this.data.embeddings).forEach((model) => {
        if (model !== this.embed_model_key) {
          delete this.data.embeddings[model];
        }
      });
    }
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
    if (this.should_embed) {
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
    }
    this._queue_embed = false;
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
  }

  /**
   * Get embed hash
   */
  get embed_hash(): string | undefined {
    return this.data.last_embed?.hash;
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
    if (!this.vec) return true;
    if (!this.embed_hash || this.embed_hash !== this.read_hash) return true;
    return false;
  }

  /**
   * Check if entity has valid embedding
   */
  has_embed(): boolean {
    return !!this.vec && this.vec.length > 0;
  }

  /**
   * Remove all embeddings
   */
  remove_embeddings(): void {
    this.data.embeddings = {};
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
    return this.collection.nearest(this.vec, {
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
