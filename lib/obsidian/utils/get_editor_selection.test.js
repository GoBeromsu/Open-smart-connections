import test from 'ava';
import { get_editor_selection } from './get_editor_selection.js';

test('returns empty string when editor missing', t => {
  t.is(get_editor_selection(null), '');
  t.is(get_editor_selection({}), '');
});

test('returns selected text', t => {
  const editor = { getSelection: () => 'hello' };
  t.is(get_editor_selection(editor), 'hello');
});
