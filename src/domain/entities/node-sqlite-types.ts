import type { Buffer } from 'node:buffer';

export type QueryMatch = { entity_key: string; score: number };

export interface EntityRow {
  entity_key: string;
  path: string;
  source_path: string | null;
  last_read_hash: string | null;
  last_read_size: number | null;
  last_read_mtime: number | null;
  text_len: number | null;
  extra: string;
  tokens: number | null;
  embed_hash: string | null;
  dims: number | null;
  updated_at: number | null;
}

export interface EmbeddingRow {
  vec: Buffer | Uint8Array | null;
  tokens: number | null;
  embed_hash: string | null;
  dims: number | null;
  updated_at: number | null;
}

export interface NearestRow {
  entity_key: string;
  vec: Buffer | Uint8Array | null;
}
