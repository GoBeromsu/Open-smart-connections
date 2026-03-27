/**
 * @file should-embed.test.ts
 * @description Tests for EmbeddingBlock.should_embed sub-block coverage logic
 */

import { describe, it, expect } from 'vitest';
import { EmbeddingBlock } from '../src/domain/entities/EmbeddingBlock';

/**
 * Build a minimal mock collection with the given items map and min_chars setting.
 * items values are plain objects — only .data.length and .size are accessed.
 */
function makeCollection(
  items: Record<string, { data: { length: number }; size: number }>,
  min_chars: number = 300,
) {
  return {
    embed_model_key: 'test-model',
    settings: { min_chars, embed_blocks: true },
    items,
    delete: () => {},
  } as any;
}

/**
 * Build an EmbeddingBlock with the given key (path) and char length.
 */
function makeBlock(
  collection: ReturnType<typeof makeCollection>,
  path: string,
  length: number,
): EmbeddingBlock {
  return new EmbeddingBlock(collection, { path, length, embeddings: {} });
}

describe('EmbeddingBlock.should_embed', () => {
  it('returns true when block has no sub-blocks', () => {
    const col = makeCollection({});
    // Large enough heading block, no sub-blocks in collection
    const block = makeBlock(col, 'note.md#Heading1', 1000);
    col.items['note.md#Heading1'] = block;

    expect(block.should_embed).toBe(true);
  });

  it('returns true when sub-block coverage is below 90%', () => {
    const col = makeCollection({});

    const heading = makeBlock(col, 'note.md#Heading1', 1000);
    // Sub-block covers only 50% of the heading text
    const sub = makeBlock(col, 'note.md#Heading1#paragraph-1', 500);

    col.items['note.md#Heading1'] = heading;
    col.items['note.md#Heading1#paragraph-1'] = sub;

    expect(heading.should_embed).toBe(true);
  });

  it('returns false when sub-blocks cover >= 90% of heading text', () => {
    const col = makeCollection({});

    const heading = makeBlock(col, 'note.md#Heading1', 1000);
    // Three paragraph sub-blocks totalling 950 / 1000 = 95% coverage
    const p1 = makeBlock(col, 'note.md#Heading1#paragraph-1', 350);
    const p2 = makeBlock(col, 'note.md#Heading1#paragraph-2', 300);
    const p3 = makeBlock(col, 'note.md#Heading1#paragraph-3', 300);

    col.items['note.md#Heading1'] = heading;
    col.items['note.md#Heading1#paragraph-1'] = p1;
    col.items['note.md#Heading1#paragraph-2'] = p2;
    col.items['note.md#Heading1#paragraph-3'] = p3;

    expect(heading.should_embed).toBe(false);
  });

  it('returns true for paragraph sub-blocks (always embedded, never skipped)', () => {
    const col = makeCollection({});

    const heading = makeBlock(col, 'note.md#Heading1', 1000);
    const para = makeBlock(col, 'note.md#Heading1#paragraph-1', 500);

    col.items['note.md#Heading1'] = heading;
    col.items['note.md#Heading1#paragraph-1'] = para;

    // paragraph block key contains '#paragraph-' — coverage check is skipped
    expect(para.should_embed).toBe(true);
  });

  it('returns false for blocks below min_chars threshold', () => {
    const col = makeCollection({}, 300);
    // length 100 is below min_chars 300
    const block = makeBlock(col, 'note.md#TinySection', 100);
    col.items['note.md#TinySection'] = block;

    expect(block.should_embed).toBe(false);
  });

  it('returns false at exactly 90% sub-block coverage boundary', () => {
    const col = makeCollection({});

    const heading = makeBlock(col, 'note.md#Heading1', 1000);
    const para = makeBlock(col, 'note.md#Heading1#paragraph-1', 900); // exactly 90%

    col.items['note.md#Heading1'] = heading;
    col.items['note.md#Heading1#paragraph-1'] = para;

    expect(heading.should_embed).toBe(false);
  });

  it('ignores items in collection that do not share the key prefix', () => {
    const col = makeCollection({});

    const heading = makeBlock(col, 'note.md#Heading1', 1000);
    // 'note.md#Heading2#paragraph-1' does NOT start with 'note.md#Heading1#'
    const unrelated = makeBlock(col, 'note.md#Heading2#paragraph-1', 950);

    col.items['note.md#Heading1'] = heading;
    col.items['note.md#Heading2#paragraph-1'] = unrelated;

    // No sub-blocks for Heading1, so should embed
    expect(heading.should_embed).toBe(true);
  });
});
