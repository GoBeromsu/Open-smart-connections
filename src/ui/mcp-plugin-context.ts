/**
 * @file mcp-plugin-context.ts
 * @description Plugin-mode McpContext adapter.
 *
 * Wraps the live SmartConnectionsPlugin instance to satisfy the McpContext
 * interface used by the domain-layer MCP dispatch logic.
 */

import { TFile } from 'obsidian';
import type SmartConnectionsPlugin from '../main';
import type {
  McpContext,
  McpSearchResult,
  McpCollectionStats,
  McpModelInfo,
  McpContextLogger,
} from '../types/mcp-context';
import type { EmbeddingBlock } from '../domain/entities/EmbeddingBlock';
import { getBlockConnections } from './block-connections';

export class PluginMcpContext implements McpContext {
  constructor(private readonly plugin: SmartConnectionsPlugin) {}

  get ready(): boolean { return this.plugin.ready; }
  get embedReady(): boolean { return this.plugin.embed_ready; }
  get statusState(): 'idle' | 'embedding' | 'error' { return this.plugin.status_state; }
  get version(): string { return this.plugin.manifest.version; }
  get logger(): McpContextLogger { return this.plugin.logger; }

  noteExists(path: string): boolean {
    return this.plugin.app.vault.getAbstractFileByPath(path) instanceof TFile;
  }

  async readNote(path: string): Promise<string | null> {
    const file = this.plugin.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    return await this.plugin.app.vault.cachedRead(file);
  }

  async embedQuery(query: string): Promise<number[]> {
    const adapter = this.plugin.search_embed_model;
    if (!adapter) throw new Error('Embedding model not available');
    const results = typeof adapter.embed_query === 'function'
      ? await adapter.embed_query(query)
      : await adapter.embed_batch([{ embed_input: query }]);
    const vec = results[0]?.vec;
    if (!vec || vec.length === 0) {
      throw new Error('Search adapter returned no embedding vector.');
    }
    return vec;
  }

  async searchNearest(
    vec: number[] | Float32Array,
    opts: { limit: number; exclude?: string[] },
  ): Promise<McpSearchResult[]> {
    if (!this.plugin.block_collection) return [];
    const raw = await this.plugin.block_collection.nearest(vec, {
      limit: opts.limit * 4,
      exclude: opts.exclude,
    });

    const deduped = new Map<string, McpSearchResult>();
    for (const result of raw) {
      const item = result.item as EmbeddingBlock;
      const sourcePath = item.source_key ?? item.key.split('#')[0];
      if (!sourcePath) continue;
      const existing = deduped.get(sourcePath);
      if (!existing || result.score > existing.score) {
        deduped.set(sourcePath, {
          path: sourcePath,
          score: result.score,
          blockKey: item.key,
          headings: item.data.headings ?? [],
          preview: typeof item.data.text === 'string'
            ? item.data.text.slice(0, 400)
            : '',
        });
      }
    }

    return [...deduped.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, opts.limit);
  }

  async getConnections(filePath: string, limit: number): Promise<McpSearchResult[]> {
    if (!this.plugin.block_collection) return [];
    const results = await getBlockConnections(this.plugin.block_collection, filePath, { limit });
    return results.map((result) => {
      const item = result.item as EmbeddingBlock;
      return {
        path: item.source_key ?? item.key.split('#')[0] ?? '',
        score: result.score,
        blockKey: item.key,
        headings: item.data.headings ?? [],
        preview: typeof item.data.text === 'string'
          ? item.data.text.slice(0, 400)
          : '',
      };
    });
  }

  getModelInfo(): McpModelInfo {
    return this.plugin.getCurrentModelInfo();
  }

  getStats(): McpCollectionStats {
    return {
      sourceCount: this.plugin.source_collection?.size ?? 0,
      embeddedSourceCount: this.plugin.source_collection?.embeddedCount ?? 0,
      blockCount: this.plugin.block_collection?.size ?? 0,
      embeddedBlockCount: this.plugin.block_collection?.embeddedCount ?? 0,
    };
  }
}
