/**
 * @file EntityCollection.ts
 * @description Base collection class with CRUD and PGlite persistence
 */

import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityData, ConnectionResult, SearchFilter } from '../types/entities';
import { PgliteDataAdapter } from './adapters/pglite-data-adapter';
import type { EmbeddingPipeline } from '../search';

/**
 * Base collection class for entities
 * Simplified from lib/core/collections/collection.js
 */
export abstract class EntityCollection<T extends EmbeddingEntity> {
  /** Collection items keyed by entity key */
  items: Record<string, T> = {};

  /** Data adapter for PGlite persistence */
  data_adapter: PgliteDataAdapter<T>;

  /** Embedding pipeline for batch processing */
  embedding_pipeline?: EmbeddingPipeline;

  /** Collection settings */
  settings: any;

  /** Data directory path */
  data_dir: string;

  /** Collection key */
  collection_key: string;

  /** Shared storage namespace */
  storage_namespace: string;

  /** Pending deletions to persist */
  private deleted_keys: Set<string> = new Set();

  /** Whether collection is loaded */
  loaded: boolean = false;

  /** Embed model key */
  embed_model_key: string = 'None';

  /** Expected embedding dimensions for the active model */
  embed_model_dims?: number;

  constructor(
    data_dir: string,
    settings: any = {},
    embed_model_key: string = 'None',
    collection_key?: string,
    storage_namespace?: string,
  ) {
    this.data_dir = data_dir;
    this.settings = settings;
    this.embed_model_key = embed_model_key;
    this.collection_key = collection_key || 'smart_sources';
    this.storage_namespace = storage_namespace || data_dir;
    this.data_adapter = new PgliteDataAdapter(this, this.collection_key, this.storage_namespace);
  }

  /**
   * Get item type constructor (to be implemented in subclasses)
   */
  abstract get_item_type(): new (collection: EntityCollection<T>, data?: Partial<EntityData>) => T;

  /**
   * Initialize collection
   */
  async init(): Promise<void> {
    // Override in subclasses if needed
  }

  /**
   * Get item by key
   */
  get(key: string): T | undefined {
    return this.items[key];
  }

  /**
   * Get multiple items by keys
   */
  get_many(keys: string[]): T[] {
    return keys.map(key => this.items[key]).filter(Boolean);
  }

  /**
   * Set item in collection
   */
  set(item: T): void {
    this.items[item.key] = item;
  }

  /**
   * Create or update an item
   */
  create_or_update(data: Partial<EntityData>): T {
    const key = data.path || '';
    let item = this.items[key];

    if (!item) {
      // Create new item
      const ItemType = this.get_item_type();
      item = new ItemType(this, data as EntityData);
      this.items[item.key] = item;
      item._queue_save = true;
    } else {
      // Update existing item
      Object.assign(item.data, data);
    }

    // Initialize item
    item.init();

    return item;
  }

  /**
   * Delete item by key
   */
  delete(key: string): void {
    this.deleted_keys.add(key);
    delete this.items[key];
  }

  /**
   * Get all items
   */
  get all(): T[] {
    return Object.values(this.items);
  }

  /**
   * Filter items
   */
  filter(filter_fn: (item: T) => boolean): T[] {
    return this.all.filter(filter_fn);
  }

  /**
   * Get embed queue (items needing embedding)
   */
  get embed_queue(): T[] {
    return this.all.filter(item => item._queue_embed && item.should_embed);
  }

  /**
   * Get save queue (items needing saving)
   */
  get save_queue(): T[] {
    return this.all.filter(item => item._queue_save);
  }

  /**
   * Consume and clear pending deletion keys
   */
  consume_deleted_keys(): string[] {
    const keys = Array.from(this.deleted_keys);
    this.deleted_keys.clear();
    return keys;
  }

  /**
   * Load collection from disk
   */
  async load(): Promise<void> {
    await this.data_adapter.load();
    this.loaded = true;
  }

  /**
   * Save collection to disk
   */
  async save(): Promise<void> {
    await this.data_adapter.save();
  }

  /**
   * Process save queue
   */
  async process_save_queue(): Promise<void> {
    const queue = this.save_queue;
    if (queue.length === 0) return;

    console.log(`Saving ${queue.length} items...`);
    await this.data_adapter.save_batch(queue);
  }

  /**
   * Find nearest entities to a vector
   */
  async nearest(vec: number[], filter: SearchFilter = {}): Promise<ConnectionResult[]> {
    const limit = filter.limit ?? 50;
    const fetch_multiplier = filter.filter_fn ? 6 : 3;
    const matches = await this.data_adapter.query_nearest(vec, filter, fetch_multiplier);
    const results: ConnectionResult[] = [];

    for (const match of matches) {
      const item = this.get(match.entity_key);
      if (!item) continue;
      if (filter.filter_fn && !filter.filter_fn(item)) continue;
      results.push({ item, score: match.score });
      if (results.length >= limit) break;
    }

    return results;
  }

  /**
   * Find nearest entities to an entity
   */
  async nearest_to(entity: T, filter: SearchFilter = {}): Promise<ConnectionResult[]> {
    await this.ensure_entity_vector(entity);
    if (!entity.vec) {
      throw new Error('Entity has no embedding vector');
    }

    return await this.nearest(entity.vec, {
      ...filter,
      exclude: [...(filter.exclude || []), entity.key],
    });
  }

  /**
   * Get collection size
   */
  get size(): number {
    return Object.keys(this.items).length;
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.items = {};
  }

  private async ensure_entity_vector(entity: T): Promise<void> {
    if (entity.vec && entity.vec.length > 0) return;
    const model_key = this.embed_model_key;
    if (!model_key || model_key === 'None') return;

    const loaded = await this.data_adapter.load_entity_vector(entity.key, model_key);
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
}
