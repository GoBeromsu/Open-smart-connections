/**
 * @file standalone-context.ts
 * @description McpContext implementation for standalone (non-Obsidian) mode.
 *
 * Reads notes from the filesystem, loads block vectors from SQLite, and
 * embeds queries via the configured API adapter. No Obsidian imports.
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { DatabaseSync } from 'node:sqlite';

import type {
  McpContext,
  McpCollectionStats,
  McpModelInfo,
  McpSearchResult,
  McpContextLogger,
} from '../types/mcp-context';
import type { PluginSettings } from '../types/settings';
import { FlatVectorIndex } from '../domain/flat-vector-index';
import { average_vectors } from '../utils/average-vectors';
import { ensureSchema } from '../domain/entities/node-sqlite-helpers';
import {
  embedQuery,
  resolveEmbedConfig,
  type StandaloneEmbedConfig,
} from './standalone-embed';
import {
  buildVectorIndex,
  detectDims,
  loadBlockMeta,
  type BlockMeta,
} from './standalone-db-loader';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createStandaloneContext(
  vaultPath: string,
  dbPath: string,
  settings: PluginSettings,
  version: string,
): McpContext {
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA synchronous = NORMAL');
  ensureSchema(db);

  const embedModel = settings.smart_sources.embed_model;
  const adapterSettings = embedModel[embedModel.adapter] as Record<string, unknown> | undefined;
  const modelKey = (adapterSettings?.model_key as string | undefined) ?? embedModel.adapter;
  const dims = detectDims(db, modelKey);

  const embedCfg = resolveEmbedConfig(embedModel, settings.smart_sources.search_model);
  embedCfg.dims = dims ?? undefined;

  const index = buildVectorIndex(db, modelKey, dims);
  const blockMeta = loadBlockMeta(db, modelKey);

  return new StandaloneMcpContext(
    vaultPath, db, index, blockMeta, embedCfg, modelKey, dims, version,
  );
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

class StandaloneMcpContext implements McpContext {
  readonly ready = true;
  readonly embedReady: boolean;
  readonly statusState = 'idle' as const;
  readonly logger: McpContextLogger = { warn: (msg, extra) => console.warn(msg, extra) };

  constructor(
    private readonly vaultPath: string,
    private readonly db: DatabaseSync,
    private readonly index: FlatVectorIndex,
    private readonly blockMeta: Map<string, BlockMeta>,
    private readonly embedCfg: StandaloneEmbedConfig,
    private readonly modelKey: string,
    private readonly dims: number | null,
    readonly version: string,
  ) {
    this.embedReady = embedCfg.adapter !== 'transformers';
  }

  async readNote(notePath: string): Promise<string | null> {
    const full = join(this.vaultPath, notePath);
    if (!existsSync(full)) return null;
    return await readFile(full, 'utf8');
  }

  noteExists(notePath: string): boolean {
    return existsSync(join(this.vaultPath, notePath));
  }

  async embedQuery(query: string): Promise<number[]> {
    return embedQuery(query, this.embedCfg);
  }

  async searchNearest(
    vec: number[] | Float32Array,
    opts: { limit: number; exclude?: string[] },
  ): Promise<McpSearchResult[]> {
    const matches = await this.index.queryNearest(
      vec,
      { exclude: opts.exclude, limit: opts.limit * 4 },
      opts.limit * 4,
    );

    const deduped = new Map<string, McpSearchResult>();
    for (const m of matches) {
      const result = this.toSearchResult(m.entity_key, m.score);
      const existing = deduped.get(result.path);
      if (!existing || result.score > existing.score) {
        deduped.set(result.path, result);
      }
    }
    return [...deduped.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit);
  }

  async getConnections(filePath: string, limit: number): Promise<McpSearchResult[]> {
    const fileBlockKeys = this.blockKeysForSource(filePath);
    if (fileBlockKeys.length === 0) return [];

    const vecs = this.loadBlockVectors(fileBlockKeys);
    if (vecs.length === 0) return [];

    const avgVec = average_vectors(vecs);
    const rawMatches = await this.index.queryNearest(
      avgVec,
      { exclude: fileBlockKeys, limit: limit * 3 },
      limit * 3,
    );

    return this.deduplicateBySource(rawMatches, filePath, limit);
  }

  getModelInfo(): McpModelInfo {
    return {
      adapter: this.embedCfg.adapter,
      modelKey: this.modelKey,
      dims: this.dims,
    };
  }

  getStats(): McpCollectionStats {
    const sourceKeys = new Set<string>();
    const embeddedSourceKeys = new Set<string>();
    let blockCount = 0;

    for (const meta of this.blockMeta.values()) {
      blockCount++;
      sourceKeys.add(meta.sourcePath);
      embeddedSourceKeys.add(meta.sourcePath);
    }

    return {
      sourceCount: sourceKeys.size,
      embeddedSourceCount: embeddedSourceKeys.size,
      blockCount,
      embeddedBlockCount: this.index.size,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private toSearchResult(entityKey: string, score: number): McpSearchResult {
    const meta = this.blockMeta.get(entityKey);
    const notePath = meta?.sourcePath ?? entityKey.split('#')[0] ?? entityKey;
    return {
      path: notePath,
      score,
      blockKey: entityKey,
      headings: meta?.headings ?? [],
      preview: (meta?.text ?? '').slice(0, 400),
    };
  }

  private blockKeysForSource(filePath: string): string[] {
    const keys: string[] = [];
    for (const [key, meta] of this.blockMeta) {
      if (meta.sourcePath === filePath) keys.push(key);
    }
    return keys;
  }

  private loadBlockVectors(keys: string[]): Float32Array[] {
    if (!this.dims) return [];
    const vecs: Float32Array[] = [];
    for (const key of keys) {
      const row = this.db.prepare(`
        SELECT vec FROM entity_embeddings
        WHERE entity_key = ? AND model_key = ? LIMIT 1
      `).get(key, this.modelKey) as { vec: Uint8Array | null } | undefined;
      if (!row?.vec || row.vec.byteLength !== this.dims * 4) continue;
      const f32 = row.vec.byteOffset % 4 === 0
        ? new Float32Array(row.vec.buffer, row.vec.byteOffset, this.dims)
        : new Float32Array(row.vec.buffer.slice(row.vec.byteOffset, row.vec.byteOffset + row.vec.byteLength));
      vecs.push(f32);
    }
    return vecs;
  }

  private deduplicateBySource(
    matches: { entity_key: string; score: number }[],
    excludeSource: string,
    limit: number,
  ): McpSearchResult[] {
    const seen = new Map<string, McpSearchResult>();
    for (const m of matches) {
      const result = this.toSearchResult(m.entity_key, m.score);
      if (result.path === excludeSource) continue;
      const existing = seen.get(result.path);
      if (!existing || result.score > existing.score) {
        seen.set(result.path, result);
      }
    }
    return [...seen.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
