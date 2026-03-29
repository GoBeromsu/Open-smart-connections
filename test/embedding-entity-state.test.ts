import { describe, expect, it } from 'vitest';
import { isEntityUnembedded } from '../src/domain/entities/embedding-entity-state';
import type { EmbeddingEntity } from '../src/domain/entities/EmbeddingEntity';

function makeEntity(overrides: {
  vec?: number[] | null;
  read_hash?: string;
  active_hash?: string;
  active_dims?: number;
  active_size?: number;
  size?: number;
  expected_dims?: number;
  re_embed_min_change?: number;
}): EmbeddingEntity {
  return {
    vec: overrides.vec ?? null,
    read_hash: overrides.read_hash,
    size: overrides.size ?? 500,
    active_embedding_meta: overrides.active_hash !== undefined
      ? {
          hash: overrides.active_hash,
          dims: overrides.active_dims,
          size: overrides.active_size,
        }
      : undefined,
    collection: {
      embed_model_dims: overrides.expected_dims,
      settings: { re_embed_min_change: overrides.re_embed_min_change ?? 0 },
    },
  } as unknown as EmbeddingEntity;
}

describe('isEntityUnembedded', () => {
  it('returns true when no vec and no read_hash (first time)', () => {
    expect(isEntityUnembedded(makeEntity({}))).toBe(true);
  });

  it('returns true when hash changed and no threshold set', () => {
    expect(isEntityUnembedded(makeEntity({
      read_hash: 'new',
      active_hash: 'old',
      active_size: 500,
      size: 501,
    }))).toBe(true);
  });

  it('returns false when hash changed but size delta below threshold', () => {
    expect(isEntityUnembedded(makeEntity({
      read_hash: 'new',
      active_hash: 'old',
      active_size: 500,
      size: 510,
      re_embed_min_change: 200,
    }))).toBe(false);
  });

  it('returns true when hash changed and size delta exceeds threshold', () => {
    expect(isEntityUnembedded(makeEntity({
      read_hash: 'new',
      active_hash: 'old',
      active_size: 500,
      size: 800,
      re_embed_min_change: 200,
    }))).toBe(true);
  });

  it('returns true on first embed even with threshold (no active_size)', () => {
    expect(isEntityUnembedded(makeEntity({
      read_hash: 'abc',
      active_hash: 'old',
      re_embed_min_change: 200,
    }))).toBe(true);
  });

  it('returns true on dims mismatch regardless of threshold', () => {
    expect(isEntityUnembedded(makeEntity({
      vec: [1, 2, 3],
      read_hash: 'same',
      active_hash: 'same',
      expected_dims: 4096,
    }))).toBe(true);
  });

  it('returns false when hash matches (no change)', () => {
    expect(isEntityUnembedded(makeEntity({
      read_hash: 'same',
      active_hash: 'same',
    }))).toBe(false);
  });

  it('skips re-embed with vec present and small change', () => {
    expect(isEntityUnembedded(makeEntity({
      vec: [1, 2, 3],
      read_hash: 'new',
      active_hash: 'old',
      active_size: 500,
      size: 505,
      expected_dims: 3,
      re_embed_min_change: 200,
    }))).toBe(false);
  });
});
