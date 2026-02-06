/**
 * smart-contexts stub module
 * Provides base classes and collections for context handling
 */

import { Collection } from '../core/collections/collection.js';
import { CollectionItem } from '../core/collections/item.js';

/**
 * SmartContext item class
 */
export class SmartContext extends CollectionItem {
  static get defaults() {
    return {
      data: {
        items: [],
      },
    };
  }
}

/**
 * SmartContexts collection class
 */
export class SmartContexts extends Collection {
  static collection_key = 'smart_contexts';
  static item_type = SmartContext;
}

// Default collection config
export const smart_contexts_default_config = {
  collections: {
    smart_contexts: {
      class: SmartContexts,
    },
  },
};

// Named export for compatibility
export const smart_contexts = {
  SmartContexts,
  SmartContext,
  ...smart_contexts_default_config,
};

export default smart_contexts;
