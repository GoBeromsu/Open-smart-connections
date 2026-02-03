import test from 'ava';
import { is_last_completion, thread_has_user_message } from './chat_context_utils.js';

function make_thread(keys, user_flags = []) {
  return {
    completions: keys.map((k, i) => ({ key: k, data: { user_message: user_flags[i] } }))
  };
}

test('is_last_completion detects last item', t => {
  const thread = make_thread(['a','b','c']);
  const completion = { key: 'c' };
  t.true(is_last_completion(thread, completion));
});

test('is_last_completion detects non-last item', t => {
  const thread = make_thread(['a','b','c']);
  const completion = { key: 'b' };
  t.false(is_last_completion(thread, completion));
});

test('thread_has_user_message returns true when user message present', t => {
  const thread = make_thread(['a','b'], [false, true]);
  t.true(thread_has_user_message(thread));
});

test('thread_has_user_message returns false when no user message', t => {
  const thread = make_thread(['a','b'], [false, false]);
  t.false(thread_has_user_message(thread));
});
