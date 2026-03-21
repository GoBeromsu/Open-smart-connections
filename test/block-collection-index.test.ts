import { describe, it, expect, beforeEach } from 'vitest';
import { BlockCollection } from '../src/domain/entities/BlockCollection';

describe('BlockCollection reverse index', () => {
  let collection: BlockCollection;

  beforeEach(() => {
    collection = new BlockCollection('/tmp/test', { min_chars: 10 }, 'test-model');
  });

  it('for_source returns blocks for a source after create_or_update', () => {
    collection.create_or_update({ path: 'note.md#heading1', text: 'content' });
    collection.create_or_update({ path: 'note.md#heading2', text: 'content2' });
    collection.create_or_update({ path: 'other.md#heading1', text: 'content3' });

    const noteBlocks = collection.for_source('note.md');
    expect(noteBlocks).toHaveLength(2);
    expect(noteBlocks.map(b => b.key).sort()).toEqual(['note.md#heading1', 'note.md#heading2']);

    const otherBlocks = collection.for_source('other.md');
    expect(otherBlocks).toHaveLength(1);
  });

  it('for_source returns empty array for unknown source', () => {
    expect(collection.for_source('nonexistent.md')).toEqual([]);
  });

  it('for_source updates after delete', () => {
    collection.create_or_update({ path: 'note.md#h1', text: 'a' });
    collection.create_or_update({ path: 'note.md#h2', text: 'b' });
    expect(collection.for_source('note.md')).toHaveLength(2);

    collection.delete('note.md#h1');
    expect(collection.for_source('note.md')).toHaveLength(1);
    expect(collection.for_source('note.md')[0].key).toBe('note.md#h2');
  });

  it('for_source handles delete all blocks for a source', () => {
    collection.create_or_update({ path: 'note.md#h1', text: 'a' });
    collection.create_or_update({ path: 'note.md#h2', text: 'b' });

    collection.delete('note.md#h1');
    collection.delete('note.md#h2');
    expect(collection.for_source('note.md')).toEqual([]);
  });

  it('for_source handles rename (delete old + add new)', () => {
    collection.create_or_update({ path: 'old.md#h1', text: 'a' });
    expect(collection.for_source('old.md')).toHaveLength(1);

    collection.delete('old.md#h1');
    collection.create_or_update({ path: 'new.md#h1', text: 'a' });

    expect(collection.for_source('old.md')).toEqual([]);
    expect(collection.for_source('new.md')).toHaveLength(1);
  });
});
