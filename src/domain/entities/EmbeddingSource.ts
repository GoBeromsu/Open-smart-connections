/**
 * @file EmbeddingSource.ts
 * @description Source (file) entity using MetadataCache
 * Ported from lib/entities/sources/smart_source.js
 */

import { EmbeddingEntity } from './EmbeddingEntity';
import type { EntityData, SourceData } from '../../types/entities';
import type { EntityCollection } from './EntityCollection';
import type { TFileShim as TFile, CachedMetadataShim as CachedMetadata, VaultShim as Vault } from '../../types/obsidian-shims';
import {
  cacheEmbeddingSourceInput,
  readEmbeddingSource,
  updateEmbeddingSourceFromFile,
} from './embedding-source-content';

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
    return await readEmbeddingSource(this);
  }

  /**
   * Get embed input for this source
   * Excludes excluded blocks and adds breadcrumbs
   */
  async get_embed_input(content: string | null = null): Promise<void> {
    await cacheEmbeddingSourceInput(this, content);
  }

  /**
   * Update file stats from TFile.
   * Uses content-based hashing so mtime-only changes (Sync, git, backup)
   * don't trigger unnecessary re-embedding.
   */
  async update_from_file(file: TFile): Promise<void> {
    await updateEmbeddingSourceFromFile(this, file);
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
