/**
 * @file EmbeddingSource.ts
 * @description Source (file) entity using MetadataCache
 * Ported from lib/entities/sources/smart_source.js
 */

import { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityData, SourceData } from '../../types/entities';
import type { EntityCollection } from './EntityCollection';
import type { TFileShim as TFile, CachedMetadataShim as CachedMetadata, VaultShim as Vault } from '../../types/obsidian-shims';
import { create_hash } from '../../utils';

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

  constructor(collection: EntityCollection<EmbeddingEntity>, data: Partial<SourceData> = {}) {
    super(collection, data, { path: '', embeddings: {} } as EntityData);
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
      return '';
    }

    try {
      return await this.vault.cachedRead(this.file);
    } catch {
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
      this._embed_input = '';
      return;
    }

    // Add breadcrumbs
    const breadcrumbs = this.path.split('/').join(' > ').replace('.md', '');

    // Limit content length
    const max_tokens = 500; // Default max tokens
    const max_chars = Math.floor(max_tokens * 3.7);

    this._embed_input = `${breadcrumbs}:\n${content}`.substring(0, max_chars);
  }

  /**
   * Update file stats from TFile.
   * Uses content-based hashing so mtime-only changes (Sync, git, backup)
   * don't trigger unnecessary re-embedding.
   */
  async update_from_file(file: TFile): Promise<void> {
    this.file = file;

    // Fast path: stat unchanged → content hasn't changed either
    if (this.data.mtime === file.stat.mtime && this.data.size === file.stat.size) {
      return;
    }

    this.data.size = file.stat.size;
    this.data.mtime = file.stat.mtime;

    // First import (no stored hash) → stat-based hash to avoid reading every file at startup.
    // Subsequent changes → content-based hash so mtime-only touches (Sync/git) don't re-embed.
    let hash: string;
    if (!this.read_hash || !this.vault) {
      hash = await create_hash(`${file.stat.mtime}-${file.stat.size}`);
    } else {
      const content = await this.vault.cachedRead(file);
      hash = await create_hash(content);
    }

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
   * Check if source is excluded
   */
  get excluded(): boolean {
    return this.data.is_excluded || false;
  }

  /**
   * Source-level embedding is disabled — blocks only.
   * Returning false prevents sources from entering the embed queue.
   */
  get should_embed(): boolean {
    return false;
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
