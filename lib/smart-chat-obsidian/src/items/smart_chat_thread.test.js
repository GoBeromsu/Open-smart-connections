import test from 'ava';
import { SmartChatThread } from './smart_chat_thread.js';

// helper to build minimal env and collection
function build_env_with_incomplete() {
  const completions = {};
  const env = {
    create_env_getter(obj) { Object.defineProperty(obj, 'env', { value: env }); },
    smart_completions: {
      set(c) { completions[c.key] = c; },
      get(k) { return completions[k]; },
      item_type: class {
        constructor(env, data) {
          this.env = env;
          this.key = data.key;
          this.data = { completion: { responses: [] }, ...data };
        }
      },
      process_save_queue: async () => {}
    },
    smart_contexts: {
      new_context() { return { key: 'ctx' }; },
      process_save_queue: async () => {}
    }
  };
  const collection = {
    settings: { stream: true, system_prompt: '', detect_self_referential: false, language: 'en' },
    items: {},
    get item_class_name() { return 'SmartChatThread'; }
  };
  env.smart_chat_threads = collection;
  const thread = new SmartChatThread(env, { key: 't1' });
  const incomplete = new env.smart_completions.item_type(env, { key: 't1-1', thread_key: 't1', completion: { responses: [] } });
  env.smart_completions.set(incomplete);
  thread.data.items[incomplete.key] = { _active: true };
  thread.data.items._active = incomplete.key;
  return { thread, incomplete, env };
}

test('does not create new completion when last lacks response', t => {
  const { thread, incomplete } = build_env_with_incomplete();
  let init_called = false;
  thread.init_completion = function() {
    init_called = true;
    return { key: 'new', data: { completion: { responses: [] } } };
  };
  const current = thread.current_completion;
  t.false(init_called);
  t.is(current, incomplete);
});
