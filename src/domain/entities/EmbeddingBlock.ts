/**
 * @file EmbeddingBlock.ts
 * @description Block entity using MetadataCache sections
 * Ported from lib/entities/blocks/smart_block.js
 */

import { EmbeddingEntity } from './EmbeddingEntity';
import type { BlockData, EntityData } from '../../types/entities';
import type { EntityCollection } from './EntityCollection';
import type { EmbeddingSource } from './EmbeddingSource';

/**
 * Block entity representing a section within a source file
 * Uses MetadataCache sections for heading-based blocks
 * Key format: path#heading1#heading2
 */
export class EmbeddingBlock extends EmbeddingEntity {
  data: BlockData;

  constructor(collection: EntityCollection<EmbeddingEntity>, data: Partial<BlockData> = {}) {
    super(collection, data, { path: '', text: '', length: 0, embeddings: {} } as EntityData);
  }

  /**
   * Get default data structure for block
   */
  protected get_defaults(): BlockData {
    return {
      ...super.get_defaults(),
      path: '',
      text: '',
      length: 0,
      embeddings: {},
    } as BlockData;
  }

  /**
   * Initialize block
   */
  init(): void {
    // Only embed if blocks are enabled in settings
    if (this.collection.settings?.embed_blocks) {
      super.init();
    }
  }

  /**
   * Read block content from source
   */
  async read(): Promise<string> {
    // If we have cached text, return it
    if (this.data.text) {
      return this.data.text;
    }

    // Otherwise read from source using line numbers
    if (!this.source) {
      return 'BLOCK NOT FOUND';
    }

    const content = await this.source.read();
    if (!content) return 'BLOCK NOT FOUND';

    if (!this.lines || this.lines.length !== 2) {
      return 'BLOCK NOT FOUND';
    }

    const lines = content.split('\n');
    const [start, end] = this.lines;

    return lines.slice(start, end + 1).join('\n');
  }

  /**
   * Get embed input for this block
   * Includes breadcrumbs and content
   */
  async get_embed_input(content: string | null = null): Promise<void> {
    if (this._embed_input && this._embed_input.length > 0) {
      return; // Already cached
    }

    if (!content) {
      content = await this.read();
    }

    this._embed_input = `${this.breadcrumbs}\n${content}`;
  }

  // Getters

  /**
   * Get breadcrumbs (path with headings)
   */
  get breadcrumbs(): string {
    return this.key
      .split('/')
      .join(' > ')
      .split('#')
      .slice(0, -1) // Remove last element (contained in content)
      .join(' > ')
      .replace('.md', '');
  }

  /**
   * Get source key (file path)
   */
  get source_key(): string {
    return this.key.split('#')[0];
  }

  /**
   * Get source entity
   */
  get source(): EmbeddingSource | undefined {
    // Access SourceCollection through collection reference
    // This assumes BlockCollection has a reference to SourceCollection
    const col = this.collection as unknown as { source_collection?: { get(key: string): EmbeddingSource | undefined } };
    return col.source_collection?.get(this.source_key);
  }

  /**
   * Get line range [start, end]
   */
  get lines(): [number, number] | undefined {
    return this.data.lines;
  }

  /**
   * Get block size (from cached length)
   */
  get size(): number {
    return this.data.length || 0;
  }

  /**
   * Get file type from source
   */
  get file_type(): string {
    return this.source?.file_type || 'md';
  }

  /**
   * Get link (with heading anchor)
   */
  get link(): string {
    return this.key;
  }

  /**
   * Check if block is excluded
   * Based on heading name or source exclusion
   */
  get excluded(): boolean {
    // Check if any heading is in excluded list
    const excluded_headings = this.collection.settings?.excluded_headings || [];
    const headings = this.data.headings || [];

    if (headings.some(h => excluded_headings.includes(h))) {
      return true;
    }

    // Check if source is excluded
    return this.source?.excluded || false;
  }

  /**
   * Check if block should be embedded
   * Must meet min size and not be fully covered by sub-blocks
   */
  get should_embed(): boolean {
    const min_chars = this.collection.settings?.min_chars || 300;
    if (this.size < min_chars) return false;

    // TODO: Check if fully covered by sub-blocks
    // For now, assume we should embed
    return true;
  }

}
