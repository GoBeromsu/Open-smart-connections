/**
 * @file entity-data.ts
 * @description Persisted entity data shapes and connection result types.
 */

interface EntityRef {
  key: string;
}

export interface LastMetadata {
  hash: string;
  size?: number;
  mtime?: number;
}

export interface EmbeddingData {
  vec: number[] | Float32Array;
  tokens?: number;
}

export interface EmbeddingModelMeta {
  hash: string;
  size?: number;
  mtime?: number;
  dims?: number;
  adapter?: string;
  updated_at?: number;
}

export interface EntityData {
  path: string;
  last_read?: LastMetadata;
  last_embed?: LastMetadata;
  embeddings: Record<string, EmbeddingData>;
  embedding_meta?: Record<string, EmbeddingModelMeta>;
  [key: string]: unknown;
}

export interface SourceData extends EntityData {
  path: string;
  extension?: string;
  size?: number;
  mtime?: number;
  is_block_level?: boolean;
  is_excluded?: boolean;
}

export interface BlockData extends EntityData {
  path: string;
  source_path?: string;
  text?: string;
  length?: number;
  lines?: [number, number];
  headings?: string[];
}

export interface ConnectionResult {
  item: EntityRef;
  score: number;
  sim?: number;
}
