/**
 * @file EmbeddingSource.ts
 * @description Source (file) entity using MetadataCache
 * Ported from lib/entities/sources/smart_source.js
 */

import { EmbeddingEntity } from './EmbeddingEntity';
import type { SourceData } from '../types/entities';
import type { EntityCollection } from './EntityCollection';
import type { TFile, CachedMetadata, Vault } from 'obsidian';
import { create_hash } from '../utils';

/**
 * Source entity representing a file in the vault
 * Uses Obsidian's MetadataCache and vault.cachedRead()
 */
export class EmbeddingSource extends EmbeddingEntity {
  data: SourceData;

  /** Obsidian vault reference */
  vault?: Vault;

  /** Obsidian file reference */
  file?: TFile;

  /** Cached metadata from MetadataCache */
  cached_metadata?: CachedMetadata;

  constructor(collection: EntityCollection<any>, data: Partial<SourceData> = {}) {
    super(collection, data);
    this.data = this.get_defaults() as SourceData;
    Object.assign(this.data, data);
    this.key = this.get_key();
  }

  /**
   * Get default data structure for source
   */
  protected get_defaults(): SourceData {
    return {
      ...super.get_defaults(),
      path: '',
      embeddings: {},
    } as SourceData;
  }

  /**
   * Initialize source
   * Checks if file exists and needs re-embedding
   */
  init(): void {
    super.init();

    // Check if needs import/update from file system
    if (this.is_outdated) {
      this.queue_import();
    }
  }

  /**
   * Queue for import (re-read from disk)
   */
  queue_import(): void {
    // In the refactored version, import is handled by SourceCollection
    // which uses MetadataCache events
    this._queue_save = true;
  }

  /**
   * Read file content using vault.cachedRead()
   */
  async read(): Promise<string> {
    if (!this.vault || !this.file) {
      console.warn(`No vault or file available for ${this.key}`);
      return '';
    }

    try {
      return await this.vault.cachedRead(this.file);
    } catch (error) {
      console.error(`Error reading ${this.key}:`, error);
      return '';
    }
  }

  /**
   * Get embed input for this source
   * Excludes excluded blocks and adds breadcrumbs
   */
  async get_embed_input(content: string | null = null): Promise<void> {
    if (typeof this._embed_input === 'string' && this._embed_input.length > 0) {
      return; // Already cached
    }

    if (!content) {
      content = await this.read();
    }

    if (!content) {
      console.warn(`No content available for embedding: ${this.path}`);
      this._embed_input = '';
      return;
    }

    // Exclude lines from excluded blocks
    if (this.excluded_lines.length > 0) {
      const content_lines = content.split('\n');
      this.excluded_lines.forEach(({ start, end }) => {
        for (let i = start; i <= end; i++) {
          content_lines[i] = '';
        }
      });
      content = content_lines.filter(line => line.length).join('\n');
    }

    // Add breadcrumbs
    const breadcrumbs = this.path.split('/').join(' > ').replace('.md', '');

    // Limit content length
    const max_tokens = 500; // Default max tokens
    const max_chars = Math.floor(max_tokens * 3.7);

    this._embed_input = `${breadcrumbs}:\n${content}`.substring(0, max_chars);
  }

  /**
   * Update file stats from TFile
   */
  async update_from_file(file: TFile): Promise<void> {
    this.file = file;
    this.data.size = file.stat.size;
    this.data.mtime = file.stat.mtime;

    // Update read hash if content changed
    const hash = await create_hash(`${file.stat.mtime}-${file.stat.size}`);
    if (this.read_hash !== hash) {
      this.read_hash = hash;
      this.queue_embed();
    }
  }

  /**
   * Update from MetadataCache
   */
  update_from_metadata(metadata: CachedMetadata): void {
    this.cached_metadata = metadata;
  }

  // Getters

  /**
   * Get file name
   */
  get file_name(): string {
    return this.path.split('/').pop() || '';
  }

  /**
   * Get file path (alias for path)
   */
  get file_path(): string {
    return this.path;
  }

  /**
   * Get file extension
   */
  get file_type(): string {
    if (!this.data.extension) {
      const ext = this.path.split('.').pop();
      this.data.extension = ext || 'md';
    }
    return this.data.extension;
  }

  /**
   * Get file size
   */
  get size(): number {
    return this.data.size || 0;
  }

  /**
   * Get mtime
   */
  get mtime(): number {
    return this.data.mtime || 0;
  }

  /**
   * Check if source is outdated (needs re-import)
   */
  get is_outdated(): boolean {
    if (!this.file) return false;

    // Check if file stat changed
    if (this.data.mtime !== this.file.stat.mtime) return true;
    if (this.data.size !== this.file.stat.size) return true;

    return false;
  }

  /**
   * Get excluded lines from excluded blocks
   * Returns array of {start, end} line ranges
   */
  get excluded_lines(): Array<{ start: number; end: number }> {
    // TODO: Implement block-level exclusion based on headings
    // For now, return empty array
    return [];
  }

  /**
   * Check if source is excluded
   */
  get excluded(): boolean {
    return this.data.is_excluded || false;
  }

  /**
   * Get blocks for this source
   * Delegates to BlockCollection
   */
  get blocks(): any[] {
    // TODO: Implement when BlockCollection is ready
    return [];
  }

  /**
   * Get inlinks (from MetadataCache)
   */
  get inlinks(): string[] {
    // TODO: Implement using MetadataCache resolvedLinks
    return [];
  }

  /**
   * Get outlinks (from MetadataCache)
   */
  get outlinks(): string[] {
    if (!this.cached_metadata?.links) return [];

    return this.cached_metadata.links
      .map(link => link.link)
      .filter(link => !link.startsWith('http'));
  }
}
