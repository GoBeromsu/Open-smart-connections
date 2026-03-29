/**
 * @file should-embed.test.ts
 * @description Tests for EmbeddingBlock.should_embed paragraph coverage logic.
 */

import { describe, expect, it } from 'vitest';
import { EmbeddingBlock } from '../src/domain/entities/EmbeddingBlock';

function makeCollection(
  items: Record<string, EmbeddingBlock>,
  min_chars: number = 300,
) {
  return {
    embed_model_key: 'test-model',
    settings: { min_chars, embed_blocks: true },
    items,
    delete: () => {},
    for_source: (sourceKey: string) =>
      Object.values(items).filter((item) => item.key.startsWith(`${sourceKey}#`)),
  } as any;
}

function makeBlock(
  collection: ReturnType<typeof makeCollection>,
  path: string,
  length: number,
): EmbeddingBlock {
  return new EmbeddingBlock(collection, { path, length, embeddings: {} });
}

describe('EmbeddingBlock.should_embed', () => {
  it('returns true when block has no paragraph descendants', () => {
    const items: Record<string, EmbeddingBlock> = {};
    const collection = makeCollection(items);
    const block = makeBlock(collection, 'note.md#Heading1', 1000);
    items[block.key] = block;

    expect(block.should_embed).toBe(true);
  });

  it('returns true when paragraph coverage is below 90%', () => {
    const items: Record<string, EmbeddingBlock> = {};
    const collection = makeCollection(items);
    const heading = makeBlock(collection, 'note.md#Heading1', 1000);
    const paragraph = makeBlock(collection, 'note.md#Heading1#paragraph-1', 500);

    items[heading.key] = heading;
    items[paragraph.key] = paragraph;

    expect(heading.should_embed).toBe(true);
  });

  it('returns false when paragraph coverage is at least 90%', () => {
    const items: Record<string, EmbeddingBlock> = {};
    const collection = makeCollection(items);
    const heading = makeBlock(collection, 'note.md#Heading1', 1000);
    const p1 = makeBlock(collection, 'note.md#Heading1#paragraph-1', 350);
    const p2 = makeBlock(collection, 'note.md#Heading1#paragraph-2', 300);
    const p3 = makeBlock(collection, 'note.md#Heading1#paragraph-3', 300);

    items[heading.key] = heading;
    items[p1.key] = p1;
    items[p2.key] = p2;
    items[p3.key] = p3;

    expect(heading.should_embed).toBe(false);
  });

  it('returns true for paragraph blocks', () => {
    const items: Record<string, EmbeddingBlock> = {};
    const collection = makeCollection(items);
    const paragraph = makeBlock(collection, 'note.md#Heading1#paragraph-1', 500);
    items[paragraph.key] = paragraph;

    expect(paragraph.should_embed).toBe(true);
  });

  it('returns false for blocks below min_chars', () => {
    const items: Record<string, EmbeddingBlock> = {};
    const collection = makeCollection(items, 300);
    const block = makeBlock(collection, 'note.md#TinySection', 100);
    items[block.key] = block;

    expect(block.should_embed).toBe(false);
  });

  it('counts nested paragraph coverage for ancestor headings', () => {
    const items: Record<string, EmbeddingBlock> = {};
    const collection = makeCollection(items);
    const heading = makeBlock(collection, 'note.md#Heading1', 1000);
    const nestedHeading = makeBlock(collection, 'note.md#Heading1#Heading2', 400);
    const paragraph = makeBlock(collection, 'note.md#Heading1#Heading2#paragraph-1', 920);

    items[heading.key] = heading;
    items[nestedHeading.key] = nestedHeading;
    items[paragraph.key] = paragraph;

    expect(heading.should_embed).toBe(false);
    expect(nestedHeading.should_embed).toBe(false);
  });
});
