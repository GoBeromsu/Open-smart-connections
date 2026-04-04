/**
 * @file standalone-db-loader.ts
 * @description SQLite initialization helpers for the standalone MCP context.
 *
 * Loads block metadata and builds the FlatVectorIndex from the plugin's
 * SQLite database. Separated from standalone-context.ts for modularity.
 */

import type { DatabaseSync } from 'node:sqlite';

import { loadVectorIndexRows } from '../domain/entities/node-sqlite-read';
import { FlatVectorIndex } from '../domain/flat-vector-index';

/** Block-level metadata used for search result previews and heading display. */
export interface BlockMeta {
  entityKey: string;
  path: string;
  sourcePath: string;
  headings: string[];
  text: string;
}

/** Build a FlatVectorIndex from all embedded block rows in the database. */
export function buildVectorIndex(
  db: DatabaseSync,
  modelKey: string,
  dims: number | null,
): FlatVectorIndex {
  const index = new FlatVectorIndex();
  if (!dims || !modelKey || modelKey === 'None') return index;
  const rows = loadVectorIndexRows(db, modelKey, 'block', dims);
  index.load(rows, dims);
  return index;
}

/** Load block metadata (headings, text preview, source path) for all embedded blocks. */
export function loadBlockMeta(
  db: DatabaseSync,
  modelKey: string,
): Map<string, BlockMeta> {
  const map = new Map<string, BlockMeta>();
  const rows = db.prepare(`
    SELECT e.entity_key, e.path, e.source_path, e.extra
    FROM entities e
    JOIN entity_embeddings em ON em.entity_key = e.entity_key AND em.model_key = ?
    WHERE e.entity_type = 'block'
  `).all(modelKey) as unknown as {
    entity_key: string;
    path: string;
    source_path: string | null;
    extra: string | null;
  }[];

  for (const row of rows) {
    const extra = parseExtraJson(row.extra);
    map.set(row.entity_key, {
      entityKey: row.entity_key,
      path: row.path,
      sourcePath: row.source_path ?? row.entity_key.split('#')[0] ?? row.path,
      headings: Array.isArray(extra.headings) ? extra.headings as string[] : [],
      text: typeof extra.text === 'string' ? extra.text : '',
    });
  }
  return map;
}

/** Detect embedding dimensions from the first available row for a model key. */
export function detectDims(db: DatabaseSync, modelKey: string): number | null {
  const row = db.prepare(`
    SELECT dims FROM entity_embeddings
    WHERE model_key = ? AND dims IS NOT NULL LIMIT 1
  `).get(modelKey) as { dims: number } | undefined;
  return row?.dims ?? null;
}

function parseExtraJson(extra: unknown): Record<string, unknown> {
  if (!extra || typeof extra !== 'string') return {};
  try {
    const parsed: unknown = JSON.parse(extra);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}
