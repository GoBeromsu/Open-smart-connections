/**
 * @file BlockCollection.ts
 * @description Block collection with MetadataCache sections support
 */

import { EntityCollection } from './EntityCollection';
import { EmbeddingBlock } from './EmbeddingBlock';
import type { EmbeddingSource } from './EmbeddingSource';
import type { SourceCollection } from './SourceCollection';
import { parse_markdown_blocks } from './parsers/markdown-splitter';

/**
 * Collection of block entities
 * Uses MetadataCache sections for heading-based blocks
 */
export class BlockCollection extends EntityCollection<EmbeddingBlock> {
  /** Reference to source collection */
  source_collection?: SourceCollection;

  constructor(
    data_dir: string,
    settings: any = {},
    embed_model_key: string = 'None',
    source_collection?: SourceCollection,
    storage_namespace?: string,
  ) {
    super(data_dir, settings, embed_model_key, 'smart_blocks', storage_namespace);
    this.source_collection = source_collection;
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
      console.warn(`Cannot import blocks for ${source.key}: no file or vault`);
      return;
    }

    // Read source content
    const content = await source.read();
    if (!content) {
      console.warn(`Cannot import blocks for ${source.key}: no content`);
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
   * Get all blocks for a source
   */
  get_source_blocks(source_key: string): EmbeddingBlock[] {
    return this.all.filter(block => block.source_key === source_key);
  }

  /**
   * Get all blocks whose source_key matches the given path.
   * Preferred alias for get_source_blocks — used by UI layer to avoid inline filter calls.
   */
  for_source(path: string): EmbeddingBlock[] {
    return this.all.filter(block => block.source_key === path);
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
