/**
 * @file SourceCollection.ts
 * @description Source collection with MetadataCache integration
 */

import { EntityCollection } from './EntityCollection';
import { EmbeddingSource } from './EmbeddingSource';
import type { EntityData, SourceData } from '../types/entities';
import type { Vault, MetadataCache, TFile } from 'obsidian';

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
  block_collection?: any;

  constructor(
    data_dir: string,
    settings: any = {},
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
   * Discover files from vault
   */
  async init(): Promise<void> {
    await super.init();

    // Discover files if vault is available
    if (this.vault) {
      await this.discover_sources();
    }
  }

  /**
   * Discover sources from vault
   * Uses vault.getMarkdownFiles()
   */
  async discover_sources(): Promise<void> {
    if (!this.vault) {
      console.warn('No vault available for source discovery');
      return;
    }

    const markdown_files = this.vault.getMarkdownFiles();
    console.log(`Discovered ${markdown_files.length} markdown files`);

    for (const file of markdown_files) {
      await this.import_source(file);
    }
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
    source.update_from_file(file);

    // Update from metadata cache
    if (this.metadata_cache) {
      const metadata = this.metadata_cache.getFileCache(file);
      if (metadata) {
        source.update_from_metadata(metadata);
      }
    }

    // Import blocks if enabled
    if (this.settings?.embed_blocks && this.block_collection) {
      await this.block_collection.import_source_blocks(source);
    }

    return source;
  }

  /**
   * Handle file creation
   */
  async on_file_create(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;
    await this.import_source(file);
  }

  /**
   * Handle file modification
   */
  async on_file_modify(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;
    await this.import_source(file);
  }

  /**
   * Handle file deletion
   */
  async on_file_delete(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;

    const source = this.get(file.path);
    if (source) {
      this.delete(file.path);

      // Also delete blocks
      if (this.block_collection) {
        this.block_collection.delete_source_blocks(file.path);
      }
    }
  }

  /**
   * Handle file rename
   */
  async on_file_rename(file: TFile, old_path: string): Promise<void> {
    if (file.extension !== 'md') return;

    // Delete old
    const old_source = this.get(old_path);
    if (old_source) {
      this.delete(old_path);

      // Delete old blocks
      if (this.block_collection) {
        this.block_collection.delete_source_blocks(old_path);
      }
    }

    // Import new
    await this.import_source(file);
  }

  /**
   * Handle metadata cache change
   */
  async on_metadata_change(file: TFile): Promise<void> {
    if (file.extension !== 'md') return;

    const source = this.get(file.path);
    if (!source) return;

    // Update metadata
    if (this.metadata_cache) {
      const metadata = this.metadata_cache.getFileCache(file);
      if (metadata) {
        source.update_from_metadata(metadata);
      }
    }

    // Re-import blocks if structure changed
    if (this.settings?.embed_blocks && this.block_collection) {
      await this.block_collection.import_source_blocks(source);
    }
  }

  /**
   * Get excluded headings from settings
   */
  get excluded_headings(): string[] {
    return this.settings?.excluded_headings || [];
  }
}
