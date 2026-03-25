/**
 * @file BlockCollection.ts
 * @description Block collection with MetadataCache sections support
 */

import { EntityCollection } from './EntityCollection';
import { EmbeddingBlock } from './EmbeddingBlock';
import type { EmbeddingSource } from './EmbeddingSource';
import type { SourceCollection } from './SourceCollection';
import { parse_markdown_blocks } from './markdown-splitter';

/**
 * Collection of block entities
 * Uses MetadataCache sections for heading-based blocks
 */
export class BlockCollection extends EntityCollection<EmbeddingBlock> {
  /** Reference to source collection */
  source_collection?: SourceCollection;

  private _sourceIndex: Map<string, Set<string>> = new Map();
  private _cachedEmbeddedSourceCount = 0;

  constructor(
    data_dir: string,
    settings: Record<string, unknown> = {},
    embed_model_key: string = 'None',
    source_collection?: SourceCollection,
    storage_namespace?: string,
  ) {
    super(data_dir, settings, embed_model_key, 'smart_blocks', storage_namespace);
    this.source_collection = source_collection;
  }

  protected onItemAdded(block: EmbeddingBlock): void {
    const sourceKey = block.source_key;
    let set = this._sourceIndex.get(sourceKey);
    if (!set) {
      set = new Set();
      this._sourceIndex.set(sourceKey, set);
    }
    set.add(block.key);
  }

  protected onItemRemoved(key: string): void {
    const sourceKey = key.split('#')[0];
    const set = this._sourceIndex.get(sourceKey);
    if (set) {
      set.delete(key);
      if (set.size === 0) this._sourceIndex.delete(sourceKey);
    }
  }

  /** Count of distinct source files with at least one embedded block */
  get embeddedSourceCount(): number {
    return this._cachedEmbeddedSourceCount;
  }

  override recomputeEmbeddedCount(): void {
    super.recomputeEmbeddedCount();
    let count = 0;
    for (const [, blockKeys] of this._sourceIndex) {
      for (const key of blockKeys) {
        const block = this.items[key];
        if (block?.has_embed()) { count++; break; }
      }
    }
    this._cachedEmbeddedSourceCount = count;
  }

  /**
   * Get item type constructor
   */
  get_item_type() {
    return EmbeddingBlock;
  }

  /**
   * Import blocks from a source
   * Uses MetadataCache sections for heading-based blocks
   * Falls back to paragraph splitting for non-heading content
   */
  async import_source_blocks(source: EmbeddingSource): Promise<void> {
    if (!source.file || !source.vault) {
      return;
    }

    // Read source content
    const content = await source.read();
    if (!content) {
      return;
    }

    const max_depth = this.settings.block_heading_depth ?? 3;

    // Parse blocks using MetadataCache sections and paragraph splitting
    const blocks = await parse_markdown_blocks(
      content,
      source.key,
      source.cached_metadata,
      max_depth,
    );

    // Create or update block entities — strip embeddings so Object.assign in
    // create_or_update does not overwrite vectors loaded from the DB with {}
    for (const block_data of blocks) {
      const { embeddings: _, ...update_data } = block_data;
      this.create_or_update(update_data);
    }

    // Clean up removed blocks
    this.cleanup_source_blocks(source.key, blocks.map(b => b.path));
  }

  /**
   * Delete blocks for a source
   */
  delete_source_blocks(source_key: string): void {
    const blocks = this.get_source_blocks(source_key);
    blocks.forEach(block => this.delete(block.key));
  }

  /**
   * Get all blocks for a source using the reverse index.
   */
  for_source(path: string): EmbeddingBlock[] {
    const keys = this._sourceIndex.get(path);
    if (!keys || keys.size === 0) return [];
    const result: EmbeddingBlock[] = [];
    for (const k of keys) {
      const block = this.items[k];
      if (block) result.push(block);
    }
    return result;
  }

  /**
   * Get all blocks for a source (alias used internally).
   */
  private get_source_blocks(source_key: string): EmbeddingBlock[] {
    return this.for_source(source_key);
  }

  /**
   * Clean up blocks that no longer exist
   */
  private cleanup_source_blocks(source_key: string, current_block_keys: string[]): void {
    const existing_blocks = this.get_source_blocks(source_key);
    const current_set = new Set(current_block_keys);

    existing_blocks.forEach(block => {
      if (!current_set.has(block.key)) {
        this.delete(block.key);
      }
    });
  }

}
