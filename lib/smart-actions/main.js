import { Collection, CollectionItem } from 'smart-collections';

/**
 * @class SmartAction
 * @extends CollectionItem
 * @description Represents a single action that can be executed.
 */
export class SmartAction extends CollectionItem {
  static get defaults() {
    return {
      data: {
        name: '',
        description: '',
        params: {},
      }
    };
  }

  get name() {
    return this.data.name || this.key;
  }

  get description() {
    return this.data.description || '';
  }

  get params() {
    return this.data.params || {};
  }

  /**
   * Execute the action with the given parameters.
   * @param {Object} params - Parameters to pass to the action.
   * @returns {Promise<*>} Result of the action execution.
   */
  async execute(params = {}) {
    const action_module = this.collection.get_action_module(this.key);
    if (!action_module) {
      throw new Error(`Action module not found: ${this.key}`);
    }
    const action_fn = action_module[this.key] || action_module.default;
    if (typeof action_fn !== 'function') {
      throw new Error(`Action function not found in module: ${this.key}`);
    }
    return await action_fn.call(this, params);
  }
}

/**
 * @class SmartActions
 * @extends Collection
 * @description Manages a collection of SmartAction instances.
 */
export class SmartActions extends Collection {
  /**
   * Retrieves an action module by key.
   * @param {string} key - The action key.
   * @returns {Object|null} The action module or null if not found.
   */
  get_action_module(key) {
    const actions = this.constructor.default_actions || {};
    return actions[key] || null;
  }

  /**
   * Gets all available action keys.
   * @returns {string[]} Array of action keys.
   */
  get available_actions() {
    return Object.keys(this.constructor.default_actions || {});
  }

  /**
   * Executes an action by key with the given parameters.
   * @param {string} action_key - The action to execute.
   * @param {Object} params - Parameters to pass to the action.
   * @returns {Promise<*>} Result of the action execution.
   */
  async execute(action_key, params = {}) {
    const action_module = this.get_action_module(action_key);
    if (!action_module) {
      throw new Error(`Action module not found: ${action_key}`);
    }
    const action_fn = action_module[action_key] || action_module.default;
    if (typeof action_fn !== 'function') {
      throw new Error(`Action function not found: ${action_key}`);
    }
    return await action_fn.call(this, params);
  }
}

/**
 * Default configuration object for smart_actions collection.
 * The default_actions property can be modified to add custom actions.
 */
export const smart_actions = {
  class: SmartActions,
  collection_key: 'smart_actions',
  item_type: SmartAction,
  default_actions: {},
};

export default smart_actions;
