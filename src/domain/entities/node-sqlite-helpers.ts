import type { Buffer } from 'node:buffer';
import { DatabaseSync } from 'node:sqlite';

import type { EntityData } from '../../types/entities';

export function vecToBlob(vec: number[] | Float32Array): Uint8Array {
  const f32 = vec instanceof Float32Array ? vec : new Float32Array(vec);
  return new Uint8Array(f32.buffer);
}

export function blobToF32(blob: Buffer | Uint8Array | null): Float32Array | null {
  if (!blob || blob.byteLength === 0 || blob.byteLength % 4 !== 0) return null;
  if (blob.byteOffset % 4 === 0) {
    return new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4);
  }
  return new Float32Array(blob.buffer.slice(blob.byteOffset, blob.byteOffset + blob.byteLength));
}

export function parseExtra(extra: unknown): Record<string, unknown> {
  if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
    return extra as Record<string, unknown>;
  }
  if (typeof extra !== 'string') return {};
  try {
    const parsed = JSON.parse(extra) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

export function extractEntityCore(data: EntityData): {
  source_path: string | null;
  text_len: number | null;
  extra: Record<string, unknown>;
} {
  const source_path = typeof data.source_path === 'string' ? data.source_path : null;
  const text_len =
    typeof data.length === 'number'
      ? data.length
      : typeof data.text === 'string'
        ? data.text.length
        : null;

  const extra: Record<string, unknown> = { ...data };
  delete extra.path;
  delete extra.embeddings;
  delete extra.embedding_meta;
  delete extra.last_read;
  delete extra.last_embed;

  return { source_path, text_len, extra };
}

export function getEntityType(collectionKey: string): 'source' | 'block' {
  return collectionKey === 'smart_blocks' ? 'block' : 'source';
}

export function withTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    fn();
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure
    }
    throw error;
  }
}

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS entities (
    entity_key TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    path TEXT NOT NULL,
    source_path TEXT,
    last_read_hash TEXT,
    last_read_size INTEGER,
    last_read_mtime INTEGER,
    text_len INTEGER,
    extra TEXT NOT NULL DEFAULT '{}'
  )`,
  `CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type)`,
  `CREATE INDEX IF NOT EXISTS idx_entities_source_path ON entities(source_path)`,
  `CREATE TABLE IF NOT EXISTS entity_embeddings (
    entity_key TEXT NOT NULL,
    model_key TEXT NOT NULL,
    vec BLOB,
    tokens INTEGER,
    embed_hash TEXT,
    dims INTEGER,
    updated_at INTEGER,
    PRIMARY KEY (entity_key, model_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_embeddings_model_key ON entity_embeddings(model_key)`,
];

export function ensureSchema(db: DatabaseSync): void {
  for (const sql of SCHEMA_STATEMENTS) {
    db.prepare(sql).run();
  }
}
