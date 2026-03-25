import type { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityData, ConnectionResult, SearchFilter } from '../../types/entities';
import { NodeSqliteDataAdapter } from './node-sqlite-data-adapter';

export abstract class EntityCollection<T extends EmbeddingEntity> {
  items: Record<string, T> = {};
  data_adapter: NodeSqliteDataAdapter<T>;
  settings: Record<string, unknown>;
  data_dir: string;
  collection_key: string;
  storage_namespace: string;
  private deleted_keys: Set<string> = new Set();
  loaded: boolean = false;
  embed_model_key: string = 'None';
  embed_model_dims?: number;

  /** Cached embedded count — recomputed at event boundaries (load, save, clear) */
  private _cachedEmbeddedCount = 0;
  private _cachedEmbeddableCount = 0;

  constructor(
    data_dir: string,
    settings: Record<string, unknown> = {},
    embed_model_key: string = 'None',
    collection_key?: string,
    storage_namespace?: string,
  ) {
    this.data_dir = data_dir;
    this.settings = settings;
    this.embed_model_key = embed_model_key;
    this.collection_key = collection_key || 'smart_sources';
    this.storage_namespace = storage_namespace || data_dir;
    this.data_adapter = new NodeSqliteDataAdapter(this, this.collection_key, this.storage_namespace);
  }

  abstract get_item_type(): new (collection: EntityCollection<T>, data?: Partial<EntityData>) => T;

  protected onItemAdded(_item: T): void { /* override in subclass */ }
  protected onItemRemoved(_key: string): void { /* override in subclass */ }

  async init(): Promise<void> {
    // Override in subclasses if needed
  }

  get(key: string): T | undefined {
    return this.items[key];
  }

  set(item: T): void {
    this.items[item.key] = item;
    this.onItemAdded(item);
  }

  create_or_update(data: Partial<EntityData>): T {
    const key = data.path || '';
    let item = this.items[key];

    if (!item) {
      const ItemType = this.get_item_type();
      item = new ItemType(this, data as EntityData);
      this.items[item.key] = item;
      item._queue_save = true;
      this.onItemAdded(item);
    } else {
      Object.assign(item.data, data);
    }

    item.init();
    return item;
  }

  delete(key: string): void {
    this.deleted_keys.add(key);
    this.onItemRemoved(key);
    delete this.items[key];
  }

  get all(): T[] {
    return Object.values(this.items);
  }

  get embed_queue(): T[] {
    return this.all.filter(item => item._queue_embed && item.should_embed);
  }

  get save_queue(): T[] {
    return this.all.filter(item => item._queue_save);
  }

  consume_deleted_keys(): string[] {
    const keys = Array.from(this.deleted_keys);
    this.deleted_keys.clear();
    return keys;
  }

  /**
   * Re-queue deletion keys after a failed persistence attempt.
   */
  restore_deleted_keys(keys: string[]): void {
    for (const key of keys) {
      this.deleted_keys.add(key);
    }
  }

  async load(): Promise<void> {
    await this.data_adapter.load();
    this.loaded = true;
  }

  async save(): Promise<void> {
    await this.data_adapter.save();
  }

  async process_save_queue(): Promise<void> {
    const queue = this.save_queue;
    if (queue.length === 0) return;

    await this.data_adapter.save_batch(queue);
  }

  async nearest(vec: number[] | Float32Array, filter: SearchFilter = {}): Promise<ConnectionResult[]> {
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

  get size(): number {
    return Object.keys(this.items).length;
  }

  /** Delegates to .size for callers that use totalCount */
  get totalCount(): number {
    return this.size;
  }

  /** Recompute the embedded count from source of truth. Call after load, save, or clear. */
  recomputeEmbeddedCount(): void {
    let embedded = 0;
    let embeddable = 0;
    for (const item of this.all) {
      if (item.has_embed()) embedded++;
      if (item.should_embed) embeddable++;
    }
    this._cachedEmbeddedCount = embedded;
    this._cachedEmbeddableCount = embeddable;
  }

  /** O(1) count of entities with valid embeddings */
  get embeddedCount(): number {
    return this._cachedEmbeddedCount;
  }

  /**
   * O(1) count of entities eligible for embedding (above min_chars threshold).
   * May drift between `recomputeEmbeddedCount()` calls during chunked processing.
   */
  get embeddableCount(): number {
    return this._cachedEmbeddableCount;
  }

  /** Effective denominator for progress display: embeddableCount if available, else total size. */
  get effectiveTotal(): number {
    return this._cachedEmbeddableCount > 0 ? this._cachedEmbeddableCount : this.size;
  }

  clear(): void {
    this.items = {};
    this._cachedEmbeddedCount = 0;
    this._cachedEmbeddableCount = 0;
  }

  async ensure_entity_vector(entity: T): Promise<void> {
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
