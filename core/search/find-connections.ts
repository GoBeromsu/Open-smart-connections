/**
 * @file find-connections.ts
 * @description Find connections to a source/block by merging source and block results
 */

import { findNearestToEntity } from './vector-search';
import type { ConnectionResult, SearchFilter } from '../types/entities';
import type { EmbeddingEntity } from '../entities/EmbeddingEntity';

/**
 * Options for finding connections
 */
export interface FindConnectionsOptions {
  /** Maximum total results to return (default 30) */
  limit?: number;

  /** Minimum similarity score threshold */
  min_score?: number;

  /** Exclude specific keys */
  exclude?: string[];

  /** Include only specific keys */
  include?: string[];

  /** Filter by key pattern */
  key_starts_with?: string;

  /** Exclude keys matching pattern */
  key_does_not_start_with?: string;

  /** Whether to exclude blocks from same source (default true) */
  exclude_same_source?: boolean;
}

/**
 * Find connections for an entity by searching both sources and blocks
 * Merges and deduplicates results from both collections
 *
 * @param entity Reference entity to find connections for
 * @param source_entities Array of source entities to search
 * @param block_entities Array of block entities to search
 * @param opts Search options
 * @returns Merged and sorted connection results
 */
export function find_connections(
  entity: EmbeddingEntity,
  source_entities: EmbeddingEntity[],
  block_entities: EmbeddingEntity[],
  opts: FindConnectionsOptions = {},
): ConnectionResult[] {
  if (!entity.vec) {
    return [];
  }

  const {
    limit = 30,
    min_score,
    exclude = [],
    include,
    key_starts_with,
    key_does_not_start_with,
    exclude_same_source = true,
  } = opts;

  // Build filter for sources
  const source_filter: SearchFilter = {
    limit: limit * 2, // Get more to allow for deduplication
    min_score,
    exclude,
    include,
    key_starts_with,
    key_does_not_start_with,
  };

  // Build filter for blocks
  const block_filter: SearchFilter = {
    limit: limit * 2,
    min_score,
    exclude,
    include,
    key_starts_with,
    key_does_not_start_with,
  };

  // Exclude blocks from same source if requested
  if (exclude_same_source) {
    const source_path = entity.key.split('#')[0]; // Get source path from entity key
    block_filter.filter_fn = (block) => {
      const block_source = block.key.split('#')[0];
      return block_source !== source_path;
    };
  }

  // Search sources
  const source_results = findNearestToEntity(entity, source_entities, source_filter);

  // Search blocks
  const block_results = findNearestToEntity(entity, block_entities, block_filter);

  // Merge results and deduplicate by source path
  const merged = merge_connection_results(source_results, block_results);

  // Sort by score and limit
  merged.sort((a, b) => b.score - a.score);

  return merged.slice(0, limit);
}

/**
 * Merge source and block results, deduplicating by source path
 * Priority: keep the highest scoring item per source
 *
 * @param source_results Results from source search
 * @param block_results Results from block search
 * @returns Merged and deduplicated results
 */
function merge_connection_results(
  source_results: ConnectionResult[],
  block_results: ConnectionResult[],
): ConnectionResult[] {
  // Track best result per source path
  const best_by_source = new Map<string, ConnectionResult>();

  // Process all results
  const all_results = [...source_results, ...block_results];

  for (const result of all_results) {
    const source_path = result.item.key.split('#')[0];
    const existing = best_by_source.get(source_path);

    if (!existing || result.score > existing.score) {
      best_by_source.set(source_path, result);
    }
  }

  return Array.from(best_by_source.values());
}

/**
 * Get source path from entity key
 * For sources: returns the key itself
 * For blocks: returns the part before first #
 */
export function get_source_path(entity_key: string): string {
  return entity_key.split('#')[0];
}
