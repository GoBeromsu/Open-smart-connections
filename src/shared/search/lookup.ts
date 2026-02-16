/**
 * @file lookup.ts
 * @description Hypothetical embedding search for chat context
 * Creates a hypothetical embedding from query text and finds similar entities
 */

import { findNearest } from './vector-search';
import type { EmbedModelAdapter } from '../types/models';
import type { ConnectionResult, SearchFilter } from '../types/entities';
import type { EmbeddingEntity } from '../entities/EmbeddingEntity';

/**
 * Options for lookup search
 */
export interface LookupOptions {
  /** Maximum results to return (default 20) */
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

  /** Search in sources only (default false) */
  sources_only?: boolean;

  /** Search in blocks only (default false) */
  blocks_only?: boolean;
}

/**
 * Perform a hypothetical embedding lookup
 * Embeds the query text and finds similar entities
 *
 * @param query Query text to embed and search for
 * @param embed_model Embedding model to use
 * @param entities Array of entities to search through
 * @param opts Lookup options
 * @returns Connection results sorted by similarity
 */
export async function lookup(
  query: string,
  embed_model: EmbedModelAdapter,
  entities: EmbeddingEntity[],
  opts: LookupOptions = {},
): Promise<ConnectionResult[]> {
  if (!query || query.trim().length === 0) {
    return [];
  }

  const {
    limit = 20,
    min_score,
    exclude = [],
    include,
    key_starts_with,
    key_does_not_start_with,
    sources_only = false,
    blocks_only = false,
  } = opts;

  // Embed the query
  const embed_results = await embed_model.embed_batch([{ _embed_input: query }]);
  if (!embed_results || embed_results.length === 0 || !embed_results[0].vec) {
    throw new Error('Failed to embed query');
  }

  const query_vec = embed_results[0].vec;

  // Build search filter
  const filter: SearchFilter = {
    limit,
    min_score,
    exclude,
    include,
    key_starts_with,
    key_does_not_start_with,
  };

  // Apply sources_only / blocks_only filter
  if (sources_only) {
    filter.filter_fn = (entity) => !entity.key.includes('#');
  } else if (blocks_only) {
    filter.filter_fn = (entity) => entity.key.includes('#');
  }

  // Find nearest entities
  return findNearest(query_vec, entities, filter);
}

/**
 * Batch lookup for multiple queries
 * Useful for gathering context from multiple query strings
 *
 * @param queries Array of query texts
 * @param embed_model Embedding model to use
 * @param entities Array of entities to search through
 * @param opts Lookup options
 * @returns Array of connection results for each query
 */
export async function batch_lookup(
  queries: string[],
  embed_model: EmbedModelAdapter,
  entities: EmbeddingEntity[],
  opts: LookupOptions = {},
): Promise<ConnectionResult[][]> {
  // Filter out empty queries
  const valid_queries = queries.filter(q => q && q.trim().length > 0);
  if (valid_queries.length === 0) {
    return [];
  }

  // Embed all queries in batch
  const embed_inputs = valid_queries.map(q => ({ _embed_input: q }));
  const embed_results = await embed_model.embed_batch(embed_inputs);

  const {
    limit = 20,
    min_score,
    exclude = [],
    include,
    key_starts_with,
    key_does_not_start_with,
    sources_only = false,
    blocks_only = false,
  } = opts;

  // Build search filter
  const filter: SearchFilter = {
    limit,
    min_score,
    exclude,
    include,
    key_starts_with,
    key_does_not_start_with,
  };

  // Apply sources_only / blocks_only filter
  if (sources_only) {
    filter.filter_fn = (entity) => !entity.key.includes('#');
  } else if (blocks_only) {
    filter.filter_fn = (entity) => entity.key.includes('#');
  }

  // Find nearest for each query vector
  const results: ConnectionResult[][] = [];
  for (const embed_result of embed_results) {
    if (!embed_result.vec) {
      results.push([]);
      continue;
    }

    const query_results = findNearest(embed_result.vec, entities, filter);
    results.push(query_results);
  }

  return results;
}
