/**
 * Adds a new message to the nested thread structure, maintaining active state.
 * @param {object} thread - Thread data structure.
 * @param {string} new_key - Key for the new message item.
 */
export function add_thread_item(thread, new_key) {
  if (Object.keys(thread.data.items).length === 0) {
    thread.data.items[new_key] = { _active: true };
    thread.data.items._active = new_key;
  } else {
    let current_node = thread.data.items;
    const active_key_at_level = '_active';

    while (current_node[active_key_at_level] && current_node[current_node[active_key_at_level]]) {
      current_node = current_node[current_node[active_key_at_level]];
    }

    const parent_node = current_node;
    parent_node[new_key] = { _active: true };
    parent_node._active = new_key;
  }
}

/**
 * Adds a variant message alongside an existing message node.
 * @param {object} thread - Thread data structure.
 * @param {string} new_variant - Key for the new variant message.
 * @param {string} adjacent_key - Existing sibling message key.
 */
export function add_thread_item_variant(thread, new_variant, adjacent_key) {
  let parent_node = null;
  let found_at_top = false;

  if (thread.data.items[adjacent_key]) {
    parent_node = thread.data.items;
    found_at_top = true;
  } else {
    const find_parent = (node) => {
      for (const key in node) {
        if (typeof node[key] === 'object' && node[key] !== null && key !== '_active') {
          if (node[key][adjacent_key]) {
            parent_node = node[key];
            return true;
          }
          if (find_parent(node[key])) return true;
        }
      }
      return false;
    };

    if (!find_parent(thread.data.items)) return;
  }

  for (const key in parent_node) {
    if (key !== '_active' && typeof parent_node[key] === 'object') {
      parent_node[key]._active = false;
    }
  }

  parent_node[new_variant] = { _active: true };
  parent_node._active = new_variant;

  if (found_at_top) {
    thread.data.items._active = new_variant;
  }
}

/**
 * Lists active property keys from the nested thread items.
 * @param {object} thread - Thread data structure.
 * @returns {string[]} - Array of active keys representing the active path.
 */
export function list_thread_items(thread) {
  const active_keys = [];
  let current_node = thread.data.items;

  while (current_node && current_node._active) {
    const active_key = current_node._active;
    if (typeof current_node[active_key] !== 'object' || current_node[active_key] === null) break;

    active_keys.push(active_key);
    current_node = current_node[active_key];
  }

  return active_keys;
}
