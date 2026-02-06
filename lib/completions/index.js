/**
 * smart-completions stub module
 * Provides base classes and collections for completion handling
 */

import { Collection } from '../core/collections/collection.js';
import { CollectionItem } from '../core/collections/item.js';

/**
 * Base adapter class for completion adapters
 */
export class SmartCompletionAdapter {
  static version = 0.1;
  static order = 0;

  static get property_name() {
    return 'base';
  }

  static item_constructor(completion) {
    // Override in subclass
  }

  constructor(item) {
    this.item = item;
  }

  get data() {
    return this.item.data;
  }

  get request() {
    return this.item.request;
  }

  get env() {
    return this.item.env;
  }

  async to_request() {
    // Override in subclass
  }

  async from_response() {
    // Override in subclass
  }
}

/**
 * SmartCompletion item class
 */
export class SmartCompletion extends CollectionItem {
  static get defaults() {
    return {
      data: {
        messages: [],
      },
    };
  }

  get request() {
    if (!this._request) this._request = { messages: [] };
    return this._request;
  }

  get response_text() {
    return this.data.response?.content || '';
  }

  async build_request() {
    return this.request;
  }
}

/**
 * SmartCompletions collection class
 */
export class SmartCompletions extends Collection {
  static collection_key = 'smart_completions';
  static item_type = SmartCompletion;

  completion_adapters = {};
}

// Default collection config
export const smart_completions_default_config = {
  collections: {
    smart_completions: {
      class: SmartCompletions,
    },
  },
};

// Named export for compatibility
export const smart_completions = {
  SmartCompletions,
  SmartCompletion,
  SmartCompletionAdapter,
  completion_adapters: {},
  ...smart_completions_default_config,
};

export default smart_completions;
