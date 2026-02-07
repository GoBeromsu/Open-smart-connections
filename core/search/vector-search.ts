/**
 * @file vector-search.ts
 * @description Pure vector similarity search functions
 */

import { cos_sim } from '../utils/cos_sim';
import { results_acc, furthest_acc, type ScoredResult, type ResultsAccumulator, type FurthestAccumulator } from '../utils/results_acc';
import { sort_by_score_descending, sort_by_score_ascending } from '../utils/sort_by_score';
import type { SearchFilter } from '../types/entities';
import type { EmbeddingEntity } from '../entities/EmbeddingEntity';

/**
 * Find nearest entities to a given vector
 * Pure function that takes a collection and returns sorted results
 *
 * @param vec Reference vector to search from
 * @param entities Array of entities to search through
 * @param filter Search filters (limit, exclude, etc.)
 * @returns Array of results sorted by score descending (highest similarity first)
 */
export function findNearest(
  vec: number[],
  entities: EmbeddingEntity[],
  filter: SearchFilter = {},
): ScoredResult<EmbeddingEntity>[] {
  if (!vec || !Array.isArray(vec)) {
    throw new Error('Invalid vector input to findNearest()');
  }

  const {
    limit = 50,
    min_score,
    exclude = [],
    include,
    key_starts_with,
    key_does_not_start_with,
    filter_fn,
  } = filter;

  // Initialize accumulator
  const nearest: ResultsAccumulator<EmbeddingEntity> = {
    results: new Set(),
    min: Number.POSITIVE_INFINITY,
    minResult: null,
  };

  // Filter and accumulate results
  for (const entity of entities) {
    // Skip if no vector
    if (!entity.vec) continue;
    if (entity.vec.length !== vec.length) {
      // Keep search resilient when stale vectors from another model remain cached.
      entity.vec = null;
      entity.queue_embed();
      continue;
    }

    // Apply filters
    if (exclude.includes(entity.key)) continue;
    if (include && !include.includes(entity.key)) continue;
    if (key_starts_with && !entity.key.startsWith(key_starts_with)) continue;
    if (key_does_not_start_with && entity.key.startsWith(key_does_not_start_with)) continue;
    if (filter_fn && !filter_fn(entity)) continue;

    // Calculate similarity
    const score = cos_sim(vec, entity.vec);

    // Apply min score filter
    if (min_score !== undefined && score < min_score) continue;

    // Accumulate result
    const result: ScoredResult<EmbeddingEntity> = { item: entity, score };
    results_acc(nearest, result, limit);
  }

  // Return sorted results
  return Array.from(nearest.results).sort(sort_by_score_descending);
}

/**
 * Find furthest entities from a given vector
 *
 * @param vec Reference vector to search from
 * @param entities Array of entities to search through
 * @param filter Search filters (limit, exclude, etc.)
 * @returns Array of results sorted by score ascending (lowest similarity first)
 */
export function findFurthest(
  vec: number[],
  entities: EmbeddingEntity[],
  filter: SearchFilter = {},
): ScoredResult<EmbeddingEntity>[] {
  if (!vec || !Array.isArray(vec)) {
    throw new Error('Invalid vector input to findFurthest()');
  }

  const {
    limit = 50,
    exclude = [],
    include,
    key_starts_with,
    key_does_not_start_with,
    filter_fn,
  } = filter;

  // Initialize accumulator
  const furthest: FurthestAccumulator<EmbeddingEntity> = {
    results: new Set(),
    max: Number.NEGATIVE_INFINITY,
    maxResult: null,
  };

  // Filter and accumulate results
  for (const entity of entities) {
    // Skip if no vector
    if (!entity.vec) continue;
    if (entity.vec.length !== vec.length) {
      entity.vec = null;
      entity.queue_embed();
      continue;
    }

    // Apply filters
    if (exclude.includes(entity.key)) continue;
    if (include && !include.includes(entity.key)) continue;
    if (key_starts_with && !entity.key.startsWith(key_starts_with)) continue;
    if (key_does_not_start_with && entity.key.startsWith(key_does_not_start_with)) continue;
    if (filter_fn && !filter_fn(entity)) continue;

    // Calculate similarity
    const score = cos_sim(vec, entity.vec);

    // Accumulate result
    const result: ScoredResult<EmbeddingEntity> = { item: entity, score };
    furthest_acc(furthest, result, limit);
  }

  // Return sorted results
  return Array.from(furthest.results).sort(sort_by_score_ascending);
}

/**
 * Find nearest entities to a given entity
 * Convenience wrapper around findNearest
 *
 * @param entity Reference entity to search from
 * @param entities Array of entities to search through (will exclude reference entity)
 * @param filter Search filters
 * @returns Array of results sorted by score descending
 */
export function findNearestToEntity(
  entity: EmbeddingEntity,
  entities: EmbeddingEntity[],
  filter: SearchFilter = {},
): ScoredResult<EmbeddingEntity>[] {
  if (!entity.vec) {
    throw new Error('Reference entity has no embedding vector');
  }

  // Automatically exclude the reference entity
  const exclude = [...(filter.exclude || []), entity.key];

  return findNearest(entity.vec, entities, { ...filter, exclude });
}
