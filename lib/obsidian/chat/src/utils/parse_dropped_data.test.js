import test from 'ava';
import { parse_dropped_data } from './parse_dropped_data.js';

function mock_dt ({ files = [], uri = '', plain = '' } = {}) {
  return {
    files,
    getData (type) {
      return type === 'text/uri-list' ? uri : plain;
    }
  };
}

test('dedupes and flattens mixed inputs', t => {
  const dt = mock_dt({
    files : [ { path: 'A.md' } ],
    uri   : 'obsidian://open?vault=V&file=B.md\nobsidian://open?vault=V&file=C.md',
    plain : 'C.md\nD.md'
  });
  t.deepEqual(
    [...parse_dropped_data(dt)].sort(),
    ['A.md','B.md','C.md','D.md']
  );
});

test('tolerates malformed obsidian URIs split across lines', t => {
  const dt = mock_dt({
    plain : 'obsidian:/\n/open?vault=X&file=Folder%2FNote.md'
  });
  t.deepEqual(
    [...parse_dropped_data(dt)],
    ['Folder/Note.md']
  );
});

test('skips empty / bogus rows', t => {
  const dt = mock_dt({ plain: '\n   \n' });
  t.deepEqual([...parse_dropped_data(dt)], []);
});

test('handles missing newline between obsidian URIs', t => {
  const dt = mock_dt({
    plain : 'obsidian://open?vault=V&file=A.mdobsidian://open?vault=V&file=B.md'
  });
  t.deepEqual(
    [...parse_dropped_data(dt)].sort(),
    ['A.md','B.md']
  );
});

test('adds .md if no extension is given', t => {
  const dt = mock_dt({
    plain : 'obsidian://open?vault=V&file=A\nobsidian://open?vault=V&file=B'
  });
  t.deepEqual(
    [...parse_dropped_data(dt)].sort(),
    ['A.md','B.md']
  );
});
