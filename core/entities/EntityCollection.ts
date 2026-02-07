/**
 * @file EntityCollection.ts
 * @description Base collection class with CRUD and AJSON persistence
 */

import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityData, ConnectionResult, SearchFilter } from '../types/entities';
import { AjsonDataAdapter, type FsAdapter } from './adapters/ajson-data-adapter';
import { findNearest, type EmbeddingPipeline } from '../search';

/**
 * Base collection class for entities
 * Simplified from lib/core/collections/collection.js
 */
export abstract class EntityCollection<T extends EmbeddingEntity> {
  /** Collection items keyed by entity key */
  items: Record<string, T> = {};

  /** Data adapter for AJSON persistence */
  data_adapter: AjsonDataAdapter<T>;

  /** Embedding pipeline for batch processing */
  embedding_pipeline?: EmbeddingPipeline;

  /** Collection settings */
  settings: any;

  /** Data directory path */
  data_dir: string;

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
    fs_adapter?: FsAdapter,
    collection_key?: string,
  ) {
    this.data_dir = data_dir;
    this.settings = settings;
    this.embed_model_key = embed_model_key;
    this.data_adapter = new AjsonDataAdapter(this, fs_adapter, collection_key);
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
    const item = this.items[key];
    if (item) {
      // Queue for deletion in adapter
      item._queue_save = true;
      delete this.items[key];
    }
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
  nearest(vec: number[], filter: SearchFilter = {}): ConnectionResult[] {
    return findNearest(vec, this.all as any[], filter);
  }

  /**
   * Find nearest entities to an entity
   */
  async nearest_to(entity: T, filter: SearchFilter = {}): Promise<ConnectionResult[]> {
    if (!entity.vec) {
      throw new Error('Entity has no embedding vector');
    }

    return this.nearest(entity.vec, {
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
}
