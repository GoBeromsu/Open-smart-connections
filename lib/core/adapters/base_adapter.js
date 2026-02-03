/**
 * @file base_adapter.js - Base adapter classes for Smart modules
 *
 * This file provides the foundational adapter patterns used across the Smart ecosystem.
 * Each module can extend these base classes for their specific needs.
 */

/**
 * Base adapter class with state management.
 * @abstract
 */
export class SmartAdapter {
  constructor(main) {
    this.main = main;
    this.state = 'unloaded';
  }

  async load() {
    this.set_state('loaded');
  }

  unload() {
    this.set_state('unloaded');
  }

  set_state(new_state) {
    const valid_states = ['unloaded', 'loading', 'loaded', 'unloading'];
    if (!valid_states.includes(new_state)) {
      throw new Error(`Invalid state: ${new_state}`);
    }
    this.state = new_state;
  }

  get is_loading() { return this.state === 'loading'; }
  get is_loaded() { return this.state === 'loaded'; }
  get is_unloading() { return this.state === 'unloading'; }
  get is_unloaded() { return this.state === 'unloaded'; }
}

/**
 * Base collection data adapter for handling batch operations.
 * @abstract
 */
export class CollectionDataAdapter {
  constructor(collection) {
    this.collection = collection;
    this.env = collection.env;
  }

  ItemDataAdapter = ItemDataAdapter;

  create_item_adapter(item) {
    if (!this.ItemDataAdapter) {
      throw new Error("No ItemDataAdapter specified and create_item_adapter not overridden.");
    }
    return new this.ItemDataAdapter(item);
  }

  async load_item(key) { throw new Error('Not implemented'); }
  async save_item(key) { throw new Error('Not implemented'); }
  async delete_item(key) { throw new Error('Not implemented'); }
  async process_load_queue() { throw new Error('Not implemented'); }
  async process_save_queue() { throw new Error('Not implemented'); }
  async clear_all() { throw new Error('Not implemented'); }

  async load_item_if_updated(item) {
    const adapter = this.create_item_adapter(item);
    await adapter.load_if_updated();
  }
}

/**
 * Base item data adapter for single item operations.
 * @abstract
 */
export class ItemDataAdapter {
  constructor(item) {
    this.item = item;
  }

  async load() { throw new Error('Not implemented'); }
  async save(ajson = null) { throw new Error('Not implemented'); }
  async delete() { throw new Error('Not implemented'); }
  get data_path() { throw new Error('Not implemented'); }
  async load_if_updated() { throw new Error('Not implemented'); }

  get collection_adapter() {
    return this.item.collection.data_adapter;
  }

  get env() {
    return this.item.env;
  }
}

/**
 * Base vector adapter for collection-level vector operations.
 * @abstract
 */
export class CollectionVectorAdapter {
  constructor(collection) {
    this.collection = collection;
  }

  async nearest(vec, filter = {}) {
    throw new Error('CollectionVectorAdapter.nearest() not implemented');
  }

  async furthest(vec, filter = {}) {
    throw new Error('CollectionVectorAdapter.furthest() not implemented');
  }

  async embed_batch(entities) {
    throw new Error('CollectionVectorAdapter.embed_batch() not implemented');
  }

  async process_embed_queue(embed_queue) {
    throw new Error('CollectionVectorAdapter.process_embed_queue() not implemented');
  }
}

/**
 * Base vector adapter for single item vector operations.
 * @abstract
 */
export class ItemVectorAdapter {
  constructor(item) {
    this.item = item;
  }

  async get_vec() {
    throw new Error('ItemVectorAdapter.get_vec() not implemented');
  }

  async set_vec(vec) {
    throw new Error('ItemVectorAdapter.set_vec() not implemented');
  }

  async delete_vec() {
    throw new Error('ItemVectorAdapter.delete_vec() not implemented');
  }
}

/**
 * Base HTTP request adapter.
 * @abstract
 */
export class HttpRequestAdapter {
  constructor(main) {
    this.main = main;
  }

  async request(request_params) {
    throw new Error("request not implemented");
  }
}

/**
 * Base HTTP response adapter.
 * @abstract
 */
export class HttpResponseAdapter {
  constructor(response) {
    this.response = response;
  }

  async headers() { throw new Error("headers not implemented"); }
  async json() { throw new Error("json not implemented"); }
  async status() { throw new Error("status not implemented"); }
  async text() { throw new Error("text not implemented"); }
}

export default {
  SmartAdapter,
  CollectionDataAdapter,
  ItemDataAdapter,
  CollectionVectorAdapter,
  ItemVectorAdapter,
  HttpRequestAdapter,
  HttpResponseAdapter
};
