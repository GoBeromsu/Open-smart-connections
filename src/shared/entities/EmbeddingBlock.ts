/**
 * @file EmbeddingBlock.ts
 * @description Block entity using MetadataCache sections
 * Ported from lib/entities/blocks/smart_block.js
 */

import { EmbeddingEntity } from './EmbeddingEntity';
import type { BlockData } from '../types/entities';
import type { EntityCollection } from './EntityCollection';
import type { EmbeddingSource } from './EmbeddingSource';

/**
 * Block entity representing a section within a source file
 * Uses MetadataCache sections for heading-based blocks
 * Key format: path#heading1#heading2
 */
export class EmbeddingBlock extends EmbeddingEntity {
  data: BlockData;

  constructor(collection: EntityCollection<any>, data: Partial<BlockData> = {}) {
    super(collection, data);
    this.data = this.get_defaults() as BlockData;
    Object.assign(this.data, data);
    this.key = this.get_key();
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
   * Queue for embedding (also queues parent source)
   */
  queue_embed(): void {
    if (this.should_embed) {
      this._queue_embed = true;
      this.source?.queue_embed();
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
    const source_collection = (this.collection as any).source_collection;
    if (!source_collection) return undefined;

    return source_collection.get(this.source_key);
  }

  /**
   * Get sub-key (heading path)
   * Format: #heading1#heading2
   */
  get sub_key(): string {
    const parts = this.key.split('#');
    if (parts.length <= 1) return '';
    return '#' + parts.slice(1).join('#');
  }

  /**
   * Get line range [start, end]
   */
  get lines(): [number, number] | undefined {
    return this.data.lines;
  }

  /**
   * Get start line
   */
  get line_start(): number | undefined {
    return this.lines?.[0];
  }

  /**
   * Get end line
   */
  get line_end(): number | undefined {
    return this.lines?.[1];
  }

  /**
   * Get block size (from cached length)
   */
  get size(): number {
    return this.data.length || 0;
  }

  /**
   * Get file path
   */
  get file_path(): string {
    return this.source_key;
  }

  /**
   * Get file type from source
   */
  get file_type(): string {
    return this.source?.file_type || 'md';
  }

  /**
   * Get embed link (with heading anchor)
   */
  get embed_link(): string {
    return `![[${this.link}]]`;
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

  /**
   * Check if block is gone (source missing or block data missing)
   */
  get is_gone(): boolean {
    if (!this.source) return true;
    if (!this.source.file) return true;
    // TODO: Check if block still exists in source
    return false;
  }

  /**
   * Get next block (following block in source)
   */
  get next_block(): EmbeddingBlock | undefined {
    if (!this.lines) return undefined;

    const next_line = this.lines[1] + 1;
    const blocks = this.source?.blocks || [];

    return blocks.find(block => {
      const block_lines = (block as any).lines;
      return block_lines && block_lines[0] === next_line;
    }) as EmbeddingBlock | undefined;
  }

  /**
   * Get sub-blocks (nested blocks within this block)
   */
  get sub_blocks(): EmbeddingBlock[] {
    const blocks = this.source?.blocks || [];

    return blocks.filter(block => {
      const block_key = (block as any).key;
      const block_lines = (block as any).lines;

      if (!block_key.startsWith(this.key + '#')) return false;
      if (!block_lines || !this.lines) return false;

      return block_lines[0] > this.lines[0] && block_lines[1] <= this.lines[1];
    }) as EmbeddingBlock[];
  }
}
