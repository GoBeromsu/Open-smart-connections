import test from 'ava';
import { SmartEnv } from 'smart-environment';
import { add_items_to_current_context } from './add_items_to_current_context.js';

function mock_thread () {
  /** create a minimal in‑memory SmartEnv */
  const env = SmartEnv.create({ app: {} }, { collections: { smart_contexts: {} } });
  env.smart_completions = { item_type: class { constructor () {} } };
  env.smart_contexts    = {                      // naive stub
    items: {},
    new_context (d) { const k = 'ctx' + Date.now(); this.items[k] = { key: k, data: d, queue_save () {} }; return this.items[k]; },
    get (k)     { return this.items[k]; },
    process_save_queue : async () => {}
  };
  const thread = {
    env,
    data: { items: { _active: true } },
    completions: [],
    new_completion (d={}) { this.completions.push(this.current_completion = { data: d, queue_save () {} }); },
    current_completion : null,
    queue_save (){}
  };
  return thread;
}

test('adds paths to new completion & context', async t => {
  const th = mock_thread();
  await add_items_to_current_context(th, ['FileA.md', 'FileB.md']);
  const ctx = th.env.smart_contexts.get(th.current_completion.data.context_key);
  t.deepEqual(Object.keys(ctx.data.context_items).sort(), ['FileA.md','FileB.md']);
});

test('merges without duplicates', async t => {
  const th = mock_thread();
  await add_items_to_current_context(th, ['A.md','B.md']);
  await add_items_to_current_context(th, ['B.md','C.md']);
  const ctx = th.env.smart_contexts.get(th.current_completion.data.context_key);
  t.deepEqual(Object.keys(ctx.data.context_items).sort(), ['A.md','B.md','C.md']);
});
