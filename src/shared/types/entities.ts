/**
 * @file entities.ts
 * @description Type definitions for entities (sources, blocks) and their embeddings
 * CRITICAL: Maintain exact data structure for cache compatibility
 */

import type { EmbeddingEntity as EmbeddingEntityClass } from '../entities/EmbeddingEntity';

/**
 * Last read/embed metadata
 */
export interface LastMetadata {
  /** Content hash at last operation */
  hash: string;
  /** Size in bytes */
  size?: number;
  /** mtime timestamp */
  mtime?: number;
}

/**
 * Embedding vector data
 * CRITICAL: This structure must match existing cache format exactly
 * Format: data.embeddings[model_key] = { vec: number[], tokens: number }
 */
export interface EmbeddingData {
  /** The embedding vector */
  vec: number[];
  /** Token count (if available) */
  tokens?: number;
}

/**
 * Per-model embedding metadata
 * Used for safe freshness checks when switching embedding models.
 */
export interface EmbeddingModelMeta {
  /** Content hash at embedding time (must match last_read.hash to be fresh) */
  hash: string;

  /** Size captured at embedding time */
  size?: number;

  /** mtime captured at embedding time */
  mtime?: number;

  /** Embedding dimensions used for this model entry */
  dims?: number;

  /** Adapter name that produced this model entry */
  adapter?: string;

  /** Updated timestamp (epoch ms) */
  updated_at?: number;
}

/**
 * Base entity data structure
 * This is the shape stored in AJSON files
 */
export interface EntityData {
  /** Entity key (path for sources, path#heading for blocks) */
  path: string;

  /** Last read metadata */
  last_read?: LastMetadata;

  /** Last embed metadata */
  last_embed?: LastMetadata;

  /**
   * Embeddings keyed by model_key
   * CRITICAL: Format must be: { [model_key]: { vec: number[], tokens?: number } }
   * Example: { "TaylorAI/bge-micro-v2": { vec: [0.1, 0.2, ...], tokens: 512 } }
   */
  embeddings: Record<string, EmbeddingData>;

  /**
   * Per-model embedding freshness metadata
   * Optional for backward compatibility with legacy caches.
   */
  embedding_meta?: Record<string, EmbeddingModelMeta>;

  /** Additional metadata */
  [key: string]: any;
}

/**
 * Source (file) entity data
 */
export interface SourceData extends EntityData {
  /** File path (same as path, for clarity) */
  path: string;

  /** File extension */
  extension?: string;

  /** File size in bytes */
  size?: number;

  /** Last modified time (mtime) */
  mtime?: number;

  /** Whether blocks should be parsed */
  is_block_level?: boolean;

  /** Excluded status */
  is_excluded?: boolean;
}

/**
 * Block entity data
 */
export interface BlockData extends EntityData {
  /** Block key in format: path#heading1#heading2 */
  path: string;

  /** Source file path */
  source_path?: string;

  /** Block text content */
  text?: string;

  /** Block length in characters */
  length?: number;

  /** Line range in source file */
  lines?: [number, number];

  /** Heading path array */
  headings?: string[];
}

/**
 * Connection result from nearest search
 */
export interface ConnectionResult {
  /** The entity item */
  item: EmbeddingEntityClass;

  /** Similarity score (cosine similarity) */
  score: number;
}

/**
 * Base interface for entities with embeddings
 * This represents the runtime entity object (not just the data)
 */
export interface EmbeddingEntity {
  /** Entity key */
  key: string;

  /** Entity data (persisted) */
  data: EntityData;

  /** Current embedding vector (cached from data.embeddings[model_key].vec) */
  vec: number[] | null;

  /** Active-model freshness metadata */
  active_embedding_meta?: EmbeddingModelMeta;

  /** Token count */
  tokens?: number;

  /** Whether entity needs re-embedding */
  _queue_embed?: boolean;

  /** Embed input text (prepared for embedding) */
  _embed_input?: string | null;

  /**
   * Get embed input text
   */
  get_embed_input(content?: string | null): Promise<void>;

  /**
   * Queue this entity for embedding
   */
  queue_embed(): void;

  /**
   * Find nearest entities to this one
   */
  nearest(filter?: any): Promise<ConnectionResult[]>;

  /**
   * Check if entity has valid embedding
   */
  has_embed(): boolean;

  /**
   * Check if entity is stale or missing for active model
   */
  is_unembedded: boolean;

  /**
   * Update active-model embedding metadata
   */
  set_active_embedding_meta(meta: EmbeddingModelMeta): void;

  /**
   * Check if entity needs re-embedding
   */
  should_embed: boolean;
}

/**
 * Search/filter parameters
 */
export interface SearchFilter {
  /** Maximum results to return */
  limit?: number;

  /** Minimum similarity score */
  min_score?: number;

  /** Exclude specific keys */
  exclude?: string[];

  /** Include only specific keys */
  include?: string[];

  /** Filter by key pattern */
  key_starts_with?: string;

  /** Exclude keys matching pattern */
  key_does_not_start_with?: string;

  /** Custom filter function */
  filter_fn?: (item: any) => boolean;
}
