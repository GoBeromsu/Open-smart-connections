import test from 'ava';
import { add_thread_item, add_thread_item_variant, list_thread_items } from './add_thread_item.js';

/**
 * Creates a mock thread object with an empty items structure.
 * @returns {object}
 */
function createMockThread() {
  return {
    data: {
      items: {}
    },
  };
}

test('When no items exist, add_message creates a new top-level message node', t => {
  const thread = createMockThread();
  t.deepEqual(thread.data.items, {}, 'Starts empty');

  add_thread_item(thread, 'msg1');

  t.deepEqual(
    thread.data.items,
    {
      _active: 'msg1',
      msg1: { _active: true }
    },
    'Creates a single top-level message node'
  );
});

test('The second message is nested under the last-added message', t => {
  const thread = createMockThread();

  add_thread_item(thread, 'msg1');
  t.deepEqual(
    thread.data.items,
    {
      _active: 'msg1',
      msg1: { _active: true }
    },
    'After adding msg1 at the top level'
  );

  add_thread_item(thread, 'msg2');
  t.deepEqual(
    thread.data.items,
    {
      _active: 'msg1',
      msg1: {
        _active: 'msg2',
        msg2: { _active: true }
      }
    },
    'Nests msg2 under msg1'
  );
});

test('Each subsequent message creates another level of nesting under the last-added node', t => {
  const thread = createMockThread();

  add_thread_item(thread, 'msg1');
  add_thread_item(thread, 'msg2');
  add_thread_item(thread, 'msg3');
  add_thread_item(thread, 'msg4');

  t.deepEqual(
    thread.data.items,
    {
      _active: 'msg1',
      msg1: {
        _active: 'msg2',
        msg2: {
          _active: 'msg3',
          msg3: {
            _active: 'msg4',
            msg4: { _active: true }
          }
        }
      }
    },
    'Forms a four-level nested chain'
  );
});

test('Newly nested items do not overwrite or remove existing sibling nodes', t => {
  const thread = createMockThread();
  thread.data.items = {
    _active: 'msg1',
    msg1: {
      _active: 'msg2a',
      msg2: { _active: false },
      msg2a: { _active: true }
    },
    msg1a: { _active: false }
  };

  add_thread_item(thread, 'msg3'); // Goes under msg1 -> msg2a
  add_thread_item(thread, 'msg4'); // Goes under msg3

  t.deepEqual(
    thread.data.items,
    {
      _active: 'msg1',
      msg1: {
        _active: 'msg2a',
        msg2: { _active: false },
        msg2a: {
          _active: 'msg3',
          msg3: {
            _active: 'msg4',
            msg4: { _active: true }
          }
        }
      },
      msg1a: { _active: false }
    },
    'Preserves existing siblings while nesting msg3 and msg4 under msg2a'
  );
});

test('Repeated keys are handled one level at a time', t => {
  const thread = createMockThread();

  add_thread_item(thread, 'msg1');
  add_thread_item(thread, 'msg2');
  add_thread_item(thread, 'msg3');
  add_thread_item(thread, 'msg4');

  t.deepEqual(
    thread.data.items,
    {
      _active: 'msg1',
      msg1: {
        _active: 'msg2',
        msg2: {
          _active: 'msg3',
          msg3: {
            _active: 'msg4',
            msg4: { _active: true }
          }
        }
      }
    },
    'Properly nests repeated msg3 and then msg4 under the last active node'
  );
});

test('When parent key does not exist in thread, add_message_variant does nothing', t => {
  const thread = createMockThread();
  // Initially empty
  t.deepEqual(thread.data.items, {}, 'Thread starts empty');

  add_thread_item_variant(thread, 'variant1', 'missing_adjacent');
  t.deepEqual(
    thread.data.items,
    {},
    'No changes since parent key was not found'
  );
});

test('When parent key exists, add_message_variant creates a variant node under the parent', t => {
  const thread = createMockThread();
  // Create a parent message
  add_thread_item(thread, 'msg1');

  add_thread_item_variant(thread, 'variant1', 'msg1');
  t.deepEqual(
    thread.data.items,
    {
      _active: 'variant1',
      msg1: {
        _active: false,
      },
      variant1: {
        _active: true
      }
    },
    'Creates a variant node under msg1 (_active=true by default, parent set to _active=false)'
  );
});

test('Adding multiple variants accumulates them under the same parent without removing siblings', t => {
  const thread = createMockThread();
  // Create a parent message
  add_thread_item(thread, 'msg1');

  // First variant
  add_thread_item_variant(thread, 'msg1vA', 'msg1');
  t.deepEqual(
    thread.data.items,
    {
      _active: 'msg1vA',
      msg1: { _active: false },
      msg1vA: { _active: true }
    },
    'First variant creation under msg1, setting msg1 inactive and msg1vA active'
  );

  // Second variant
  add_thread_item_variant(thread, 'msg1vB', 'msg1');
  t.deepEqual(
    thread.data.items,
    {
      _active: 'msg1vB',
      msg1: { _active: false },
      msg1vA: { _active: false },
      msg1vB: { _active: true }
    },
    'Second variant creation under msg1, preserving existing siblings and setting msg1vB active'
  );
});

test('handles nested variants', t => {
  const thread = createMockThread();
  add_thread_item(thread, 'msg1');
  add_thread_item(thread, 'msg2');

  add_thread_item_variant(thread, 'msg2a', 'msg2');
  t.deepEqual(
    thread.data.items,
    {
      _active: 'msg1',
      msg1: {
        _active: 'msg2a',
        msg2: {
          _active: false
        },
        msg2a: {
          _active: true
        },
      }
    },
    'Both variants should exist under the msgA node as siblings'
  );
  add_thread_item_variant(thread, 'msg2b', 'msg2');
  t.deepEqual(
    thread.data.items,
    {
      _active: 'msg1',
      msg1: {
        _active: 'msg2b',
        msg2: {
          _active: false
        },
        msg2a: {
          _active: false 
        },
        msg2b: {
          _active: true
        }
      }
    },
    'Both variants should exist under the msgA node as siblings'
  );
})


test('list_thread_items returns active keys for single-level active item', t => {
  const thread = createMockThread();
  add_thread_item(thread, 'msg1');

  t.deepEqual(list_thread_items(thread), ['msg1']);
});

test('list_thread_items returns active keys for deeply nested active items', t => {
  const thread = createMockThread();
  add_thread_item(thread, 'msg1');
  add_thread_item(thread, 'msg2');
  add_thread_item(thread, 'msg3');

  t.deepEqual(list_thread_items(thread), ['msg1', 'msg2', 'msg3']);
});

test('list_thread_items correctly returns active keys after adding variants', t => {
  const thread = createMockThread();
  add_thread_item(thread, 'msg1');
  add_thread_item(thread, 'msg2');
  add_thread_item_variant(thread, 'msg2_variant', 'msg2');
  add_thread_item(thread, 'msg3');

  t.deepEqual(list_thread_items(thread), ['msg1', 'msg2_variant', 'msg3']);
});

test('list_thread_items returns empty array when thread has no active items', t => {
  const thread = createMockThread();
  t.deepEqual(list_thread_items(thread), []);
});

test('list_thread_items accurately reflects active path after multiple variant toggles', t => {
  const thread = createMockThread();
  add_thread_item(thread, 'msg1');
  add_thread_item(thread, 'msg2');
  add_thread_item_variant(thread, 'variant_a', 'msg2');
  add_thread_item_variant(thread, 'variant_b', 'variant_a');

  t.deepEqual(list_thread_items(thread), ['msg1', 'variant_b']);
});