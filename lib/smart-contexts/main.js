import { Collection, CollectionItem } from 'smart-collections';
import { deep_merge } from 'smart-utils/deep_merge.js';
import { create_uid } from 'smart-collections/utils/helpers.js';

/**
 * @class SmartContext
 * @extends CollectionItem
 * @description Represents a context containing items for AI processing.
 */
export class SmartContext extends CollectionItem {
  static get defaults() {
    return {
      data: {
        key: '',
        context_items: {},
      },
      meta: {},
    };
  }

  /**
   * Generates a unique key for the context.
   * @returns {string}
   */
  get_key() {
    if (this.data.key) return this.data.key;
    return create_uid(this.data);
  }

  /**
   * Gets the context key.
   * @returns {string}
   */
  get key() {
    if (!this.data.key) {
      this.data.key = this.get_key();
    }
    return this.data.key;
  }

  /**
   * Checks if context has any items.
   * @returns {boolean}
   */
  get has_context_items() {
    return Object.keys(this.data.context_items || {}).length > 0;
  }

  /**
   * Gets context items as an array with path information.
   * @returns {Array<{path: string, d?: number, score?: number, content?: string}>}
   */
  get_context_items() {
    const items = [];
    for (const [path, item_data] of Object.entries(this.data.context_items || {})) {
      items.push({
        path,
        ...item_data,
      });
    }
    return items;
  }

  /**
   * Adds items to the context.
   * @param {Array<{key: string, score?: number, d?: number}>} items
   */
  add_items(items) {
    if (!this.data.context_items) this.data.context_items = {};
    for (const item of items) {
      const key = item.key || item.path;
      if (!key) continue;
      if (!this.data.context_items[key]) {
        this.data.context_items[key] = {};
      }
      if (item.score !== undefined) this.data.context_items[key].score = item.score;
      if (item.d !== undefined) this.data.context_items[key].d = item.d;
    }
    this.queue_save();
  }

  /**
   * Gets a reference to a SmartSource or SmartBlock by path.
   * @param {string} path
   * @returns {Object|null}
   */
  get_ref(path) {
    if (!path) return null;
    const env = this.env;
    if (path.includes('#')) {
      return env.smart_blocks?.get(path) || env.smart_sources?.get(path.split('#')[0]);
    }
    return env.smart_sources?.get(path);
  }

  /**
   * Compiles the context into a string with statistics.
   * @param {Object} opts
   * @param {number} [opts.link_depth=0] - Depth of linked notes to include
   * @param {boolean} [opts.calculating=false] - If true, skip actual content retrieval
   * @returns {Promise<{context: string, stats: Object, images: string[]}>}
   */
  async compile(opts = {}) {
    const { link_depth = 0, calculating = false } = opts;
    const env = this.env;
    const context_parts = [];
    const stats = {
      char_count: 0,
      file_count: 0,
      block_count: 0,
    };
    const images = [];
    const processed_keys = new Set();

    const process_item = async (key, depth = 0) => {
      if (processed_keys.has(key)) return;
      processed_keys.add(key);

      const ref = this.get_ref(key);
      if (!ref) {
        // Check for inline content
        const item_data = this.data.context_items[key];
        if (item_data?.content) {
          const content = item_data.content;
          stats.char_count += content.length;
          if (!calculating) {
            context_parts.push(`## Inline: ${key}\n\n${content}`);
          }
        }
        return;
      }

      // Get content from the reference
      const content = await ref.read?.() || ref.content || '';
      if (!content) return;

      stats.char_count += content.length;
      if (key.includes('#')) {
        stats.block_count++;
      } else {
        stats.file_count++;
      }

      if (!calculating) {
        const header = `## ${key}`;
        context_parts.push(`${header}\n\n${content}`);
      }

      // Process linked items if depth allows
      if (depth < link_depth && ref.outlinks) {
        for (const link_key of ref.outlinks) {
          await process_item(link_key, depth + 1);
        }
      }
    };

    // Process all context items
    for (const key of Object.keys(this.data.context_items || {})) {
      await process_item(key, 0);
    }

    return {
      context: context_parts.join('\n\n---\n\n'),
      stats,
      images,
    };
  }
}

/**
 * @class SmartContexts
 * @extends Collection
 * @description Manages a collection of SmartContext instances.
 */
export class SmartContexts extends Collection {
  /**
   * Creates a new context.
   * @param {Object} [data={}] - Initial data for the context
   * @param {Object} [opts={}] - Options
   * @param {Array<{key?: string, path?: string}>} [opts.add_items] - Items to add to the context
   * @returns {SmartContext}
   */
  new_context(data = {}, opts = {}) {
    const context_data = {
      context_items: {},
      ...data,
    };

    // Generate a key if not provided
    if (!context_data.key) {
      context_data.key = `ctx_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    const context = this.create_or_update(context_data);

    // Add initial items if provided
    if (opts.add_items?.length) {
      const items = opts.add_items.map(item => {
        if (typeof item === 'string') return { key: item };
        return { key: item.key || item.path, ...item };
      });
      context.add_items(items);
    }

    return context;
  }

  /**
   * Default settings for the contexts collection.
   * @returns {Object}
   */
  static get default_settings() {
    return {
      compile_format: 'markdown',
    };
  }

  /**
   * Settings configuration for the UI.
   * @returns {Object}
   */
  get settings_config() {
    return {
      compile_format: {
        name: 'Compile Format',
        type: 'dropdown',
        options: ['markdown', 'plain'],
        description: 'Format for compiled context output.',
        default: 'markdown',
      },
    };
  }
}

/**
 * Default configuration object for smart_contexts collection.
 */
export const smart_contexts = {
  class: SmartContexts,
  collection_key: 'smart_contexts',
  item_type: SmartContext,
};

export default smart_contexts;
