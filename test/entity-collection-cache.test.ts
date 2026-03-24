/**
 * @file entity-collection-cache.test.ts
 * @description Tests for the embeddableCount / embeddedCount cache on EntityCollection
 *
 * Covers:
 *   - embeddableCount and embeddedCount start at 0 before recomputeEmbeddedCount is called
 *   - recomputeEmbeddedCount counts entities where has_embed() === true
 *   - recomputeEmbeddedCount counts entities where should_embed === true
 *   - embeddableCount is 0 when all entities are too short (should_embed = false)
 *   - clear() resets both cached counts to 0
 *   - counts are O(1) after recompute (values match subsequent reads without re-scanning)
 *   - mixed collection: correct split between embedded / embeddable
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { EntityCollection } from '../src/domain/entities/EntityCollection';
import { EmbeddingEntity } from '../src/domain/entities/EmbeddingEntity';

// ── Concrete subclass for testing ────────────────────────────────────────────

class TestCollection extends EntityCollection<EmbeddingEntity> {
  get_item_type() {
    return EmbeddingEntity;
  }
}

// ── Helper: build a minimal entity with controllable has_embed / should_embed ─

function makeEntity(
  collection: TestCollection,
  key: string,
  opts: { hasEmbed: boolean; shouldEmbed: boolean },
): EmbeddingEntity {
  const entity = new EmbeddingEntity(collection as any, { path: key, embeddings: {} });
  // Override the two computed properties the cache depends on
  Object.defineProperty(entity, 'has_embed', { value: () => opts.hasEmbed, writable: true });
  Object.defineProperty(entity, 'should_embed', { get: () => opts.shouldEmbed, configurable: true });
  collection.set(entity);
  return entity;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('EntityCollection embeddableCount cache', () => {
  let collection: TestCollection;

  beforeEach(() => {
    collection = new TestCollection('/test/data', { min_chars: 300 }, 'test-model');
  });

  it('starts at 0 before recomputeEmbeddedCount is called', () => {
    makeEntity(collection, 'a.md', { hasEmbed: true, shouldEmbed: true });
    makeEntity(collection, 'b.md', { hasEmbed: false, shouldEmbed: true });

    // No recompute yet — values must still be 0 (not scanned lazily)
    expect(collection.embeddedCount).toBe(0);
    expect(collection.embeddableCount).toBe(0);
  });

  it('recomputeEmbeddedCount counts entities with has_embed() === true', () => {
    makeEntity(collection, 'a.md', { hasEmbed: true, shouldEmbed: true });
    makeEntity(collection, 'b.md', { hasEmbed: true, shouldEmbed: true });
    makeEntity(collection, 'c.md', { hasEmbed: false, shouldEmbed: true });

    collection.recomputeEmbeddedCount();

    expect(collection.embeddedCount).toBe(2);
  });

  it('recomputeEmbeddedCount counts entities where should_embed === true', () => {
    makeEntity(collection, 'a.md', { hasEmbed: true, shouldEmbed: true });
    makeEntity(collection, 'b.md', { hasEmbed: false, shouldEmbed: true });
    makeEntity(collection, 'c.md', { hasEmbed: false, shouldEmbed: false }); // too short

    collection.recomputeEmbeddedCount();

    expect(collection.embeddableCount).toBe(2);
  });

  it('returns 0 embeddableCount when all entities are too short', () => {
    makeEntity(collection, 'a.md', { hasEmbed: false, shouldEmbed: false });
    makeEntity(collection, 'b.md', { hasEmbed: false, shouldEmbed: false });

    collection.recomputeEmbeddedCount();

    expect(collection.embeddableCount).toBe(0);
    expect(collection.embeddedCount).toBe(0);
  });

  it('embeddableCount is 0 on an empty collection after recompute', () => {
    collection.recomputeEmbeddedCount();

    expect(collection.embeddableCount).toBe(0);
    expect(collection.embeddedCount).toBe(0);
  });

  it('clear() resets both cached counts to 0', () => {
    makeEntity(collection, 'a.md', { hasEmbed: true, shouldEmbed: true });
    collection.recomputeEmbeddedCount();
    expect(collection.embeddedCount).toBe(1);
    expect(collection.embeddableCount).toBe(1);

    collection.clear();

    expect(collection.embeddedCount).toBe(0);
    expect(collection.embeddableCount).toBe(0);
  });

  it('recompute after clear reflects zero because items were removed', () => {
    makeEntity(collection, 'a.md', { hasEmbed: true, shouldEmbed: true });
    collection.recomputeEmbeddedCount();

    collection.clear();
    collection.recomputeEmbeddedCount();

    expect(collection.embeddedCount).toBe(0);
    expect(collection.embeddableCount).toBe(0);
  });

  it('cached values are stable across multiple reads without re-scanning', () => {
    makeEntity(collection, 'a.md', { hasEmbed: true, shouldEmbed: true });
    makeEntity(collection, 'b.md', { hasEmbed: false, shouldEmbed: true });
    collection.recomputeEmbeddedCount();

    // Read multiple times — value must be consistent (O(1))
    expect(collection.embeddedCount).toBe(1);
    expect(collection.embeddedCount).toBe(1);
    expect(collection.embeddableCount).toBe(2);
    expect(collection.embeddableCount).toBe(2);
  });

  it('correctly tracks a mixed collection of embedded / embeddable / short entities', () => {
    makeEntity(collection, 'embedded-1.md', { hasEmbed: true, shouldEmbed: true });
    makeEntity(collection, 'embedded-2.md', { hasEmbed: true, shouldEmbed: true });
    makeEntity(collection, 'queued.md',     { hasEmbed: false, shouldEmbed: true });
    makeEntity(collection, 'too-short.md',  { hasEmbed: false, shouldEmbed: false });

    collection.recomputeEmbeddedCount();

    // 2 embedded, 3 embeddable (embedded-1, embedded-2, queued — all above min_chars)
    expect(collection.embeddedCount).toBe(2);
    expect(collection.embeddableCount).toBe(3);
  });

  it('recompute is idempotent when nothing changes between calls', () => {
    makeEntity(collection, 'a.md', { hasEmbed: true, shouldEmbed: true });
    collection.recomputeEmbeddedCount();
    const first = { embedded: collection.embeddedCount, embeddable: collection.embeddableCount };
    collection.recomputeEmbeddedCount();
    const second = { embedded: collection.embeddedCount, embeddable: collection.embeddableCount };

    expect(second).toEqual(first);
  });
});
