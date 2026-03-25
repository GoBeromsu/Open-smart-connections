/**
 * @file SourceCollection.ts
 * @description Source collection with MetadataCache integration
 */

import { EntityCollection } from './EntityCollection';
import { EmbeddingSource } from './EmbeddingSource';
import type { SourceData } from '../../types/entities';
import type { VaultShim as Vault, MetadataCacheShim as MetadataCache, TFileShim as TFile } from '../../types/obsidian-shims';

/**
 * Collection of source entities
 * Integrates with Obsidian's MetadataCache for file discovery
 */
export class SourceCollection extends EntityCollection<EmbeddingSource> {
  /** Obsidian vault reference */
  vault?: Vault;

  /** Obsidian MetadataCache reference */
  metadata_cache?: MetadataCache;

  /** Block collection reference */
  block_collection?: { settings?: Record<string, unknown>; embed_blocks?: boolean; import_source_blocks(source: EmbeddingSource): Promise<void> };

  /** False once SQLite load is complete; import_source only parses blocks when this is false */
  _initializing = true;

  constructor(
    data_dir: string,
    settings: Record<string, unknown> = {},
    embed_model_key: string = 'None',
    vault?: Vault,
    metadata_cache?: MetadataCache,
    storage_namespace?: string,
  ) {
    super(data_dir, settings, embed_model_key, 'smart_sources', storage_namespace);
    this.vault = vault;
    this.metadata_cache = metadata_cache;
  }

  /**
   * Get item type constructor
   */
  get_item_type() {
    return EmbeddingSource;
  }

  /**
   * Initialize collection
   */
  async init(): Promise<void> {
    await super.init();
  }

  /**
   * Import a source file
   * Creates or updates source entity from TFile
   */
  async import_source(file: TFile): Promise<EmbeddingSource> {
    const key = file.path;

    // Get or create source
    let source = this.get(key);
    if (!source) {
      source = this.create_or_update({
        path: file.path,
      } as SourceData);
    }

    // Update from file
    source.vault = this.vault;
    await source.update_from_file(file);

    // Update from metadata cache
    if (this.metadata_cache) {
      const metadata = this.metadata_cache.getFileCache(file);
      if (metadata) {
        source.update_from_metadata(metadata);
      }
    }

    // Skip block import during initial discovery — blocks are loaded from SQLite.
    // Only parse blocks on file change (re-import after vault events).
    if (!this._initializing && this.block_collection?.settings?.embed_blocks) {
      await this.block_collection.import_source_blocks(source);
    }

    return source;
  }

  /**
   * Get excluded headings from settings
   */
  get excluded_headings(): string[] {
    return this.settings?.excluded_headings || [];
  }
}
