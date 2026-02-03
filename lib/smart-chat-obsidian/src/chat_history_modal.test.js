import test from 'ava';
import { filter_history_items } from './utils/filter_history_items.js';

const make_thread = ({ key, name = '', completions = [], deleted = false }) => ({
  key,
  name,
  completions,
  deleted,
});

test('includes threads with multiple completions', t => {
  const threads = [
    make_thread({ key: 't1', completions: [{}, {}] })
  ];
  const result = filter_history_items(threads);
  t.is(result.length, 1);
});

test('includes threads with single completion that has a response', t => {
  const threads = [
    make_thread({ key: 't1', completions: [{ response: 'done' }] })
  ];
  const result = filter_history_items(threads);
  t.is(result.length, 1);
});

test('includes renamed threads without messages', t => {
  const threads = [
    make_thread({ key: 't1', name: 'My Chat', completions: [{}] })
  ];
  const result = filter_history_items(threads);
  t.is(result.length, 1);
});

test('excludes unnamed threads without responses', t => {
  const threads = [
    make_thread({ key: 't1', completions: [{}] })
  ];
  const result = filter_history_items(threads);
  t.is(result.length, 0);
});
