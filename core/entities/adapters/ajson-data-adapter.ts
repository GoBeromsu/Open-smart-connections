/**
 * @file ajson-data-adapter.ts
 * @description AJSON data adapter for entity persistence
 * CRITICAL: Format must match existing cache for compatibility
 * AJSON format: append-only JSON log with collection_key:item_key entries
 */

import type { EmbeddingEntity } from '../EmbeddingEntity';
import type { EntityCollection } from '../EntityCollection';
import type { EntityData } from '../../types/entities';

/**
 * File system adapter interface
 * Matches Obsidian's DataAdapter API
 */
export interface FsAdapter {
  read(normalizedPath: string): Promise<string>;
  write(normalizedPath: string, data: string): Promise<void>;
  append(normalizedPath: string, data: string): Promise<void>;
  stat(normalizedPath: string): Promise<{ ctime: number; mtime: number; size: number } | null>;
  list(normalizedPath: string): Promise<{ files: string[]; folders: string[] }>;
  exists(normalizedPath: string): Promise<boolean>;
  mkdir(normalizedPath: string): Promise<void>;
  remove(normalizedPath: string): Promise<void>;
}

/**
 * AJSON data adapter for entity collections
 * Handles loading and saving entities to .ajson files
 *
 * AJSON Format:
 * - Each file is a log of entity states
 * - Each line: "collection_key:item_key": data,
 * - Null data indicates deletion
 * - On load: parse all lines, compute final state
 * - On save: append new line with latest state
 * - Periodically rewrite to minimal form
 */
export class AjsonDataAdapter<T extends EmbeddingEntity> {
  collection: EntityCollection<T>;
  fs_adapter?: FsAdapter;
  private _collection_key: string;

  constructor(
    collection: EntityCollection<T>,
    fs_adapter?: FsAdapter,
    collection_key: string = 'smart_sources'
  ) {
    this.collection = collection;
    this.fs_adapter = fs_adapter;
    this._collection_key = collection_key;
  }

  /**
   * Load collection from AJSON files
   * Reads all .ajson files in data directory
   */
  async load(): Promise<void> {
    console.log(`Loading ${this.collection_key} from ${this.collection.data_dir}`);

    // Auto-detect collection key from existing files
    const detected_key = await this.detect_collection_key();
    if (detected_key) {
      this._collection_key = detected_key;
      console.log(`Auto-detected collection key: ${detected_key}`);
    }

    // Check if data directory exists
    if (!await this.dir_exists(this.collection.data_dir)) {
      console.log(`Data directory does not exist: ${this.collection.data_dir}`);
      await this.create_dir(this.collection.data_dir);
      return;
    }

    // List all .ajson files
    const files = await this.list_ajson_files(this.collection.data_dir);
    console.log(`Found ${files.length} AJSON files`);

    // Load each file
    for (const file_path of files) {
      await this.load_file(file_path);
    }

    console.log(`Loaded ${this.collection.size} items`);
  }

  /**
   * Load a single AJSON file
   * Parses all entries and creates/updates entities
   */
  async load_file(file_path: string): Promise<void> {
    try {
      const content = await this.read_file(file_path);
      if (!content || content.trim().length === 0) return;

      // Parse AJSON content
      const entries = this.parse_ajson(content);

      // Create or update entities
      for (const [key, data] of Array.from(entries)) {
        if (data === null) {
          // Delete entry
          this.collection.delete(key);
        } else {
          // Create or update
          this.collection.create_or_update(data);
        }
      }
    } catch (error) {
      console.error(`Error loading file ${file_path}:`, error);
    }
  }

  /**
   * Save collection to AJSON files
   * Appends or rewrites entity states
   */
  async save(): Promise<void> {
    const queue = this.collection.save_queue;
    if (queue.length === 0) return;

    console.log(`Saving ${queue.length} items to ${this.collection.data_dir}`);

    await this.save_batch(queue);

    console.log(`Saved ${queue.length} items`);
  }

  /**
   * Save a batch of entities
   * Groups by file and appends/rewrites
   */
  async save_batch(entities: T[]): Promise<void> {
    // Group entities by file
    const file_groups = new Map<string, T[]>();

    for (const entity of entities) {
      const file_path = this.get_file_path(entity.key);
      if (!file_groups.has(file_path)) {
        file_groups.set(file_path, []);
      }
      file_groups.get(file_path)!.push(entity);
    }

    // Save each file group
    for (const [file_path, group_entities] of Array.from(file_groups)) {
      await this.save_file(file_path, group_entities);
    }

    // Clear save flags
    entities.forEach(entity => {
      entity._queue_save = false;
    });
  }

  /**
   * Save entities to a single AJSON file
   * Appends new lines for changed entities
   */
  async save_file(file_path: string, entities: T[]): Promise<void> {
    try {
      // Read existing content
      let existing_content = '';
      if (await this.file_exists(file_path)) {
        existing_content = await this.read_file(file_path);
      }

      // Build new content by appending
      let new_content = existing_content;

      for (const entity of entities) {
        const ajson_line = this.build_ajson_line(entity);
        new_content += ajson_line + '\n';
      }

      // Write file
      await this.write_file(file_path, new_content);

      // Check if file needs compaction
      const line_count = new_content.split('\n').filter(l => l.trim()).length;
      if (line_count > 100) {
        await this.compact_file(file_path);
      }
    } catch (error) {
      console.error(`Error saving file ${file_path}:`, error);
    }
  }

  /**
   * Compact AJSON file to minimal form
   * Removes historical entries, keeps only latest state
   */
  async compact_file(file_path: string): Promise<void> {
    try {
      const content = await this.read_file(file_path);
      const entries = this.parse_ajson(content);

      // Build minimal AJSON
      let minimal_content = '';
      for (const [key, data] of Array.from(entries)) {
        if (data !== null) {
          const line = this.build_ajson_line_raw(key, data);
          minimal_content += line + '\n';
        }
      }

      await this.write_file(file_path, minimal_content);
      console.log(`Compacted ${file_path}`);
    } catch (error) {
      console.error(`Error compacting file ${file_path}:`, error);
    }
  }

  /**
   * Parse AJSON content into entries
   * Returns map of key -> data (null for deletions)
   */
  parse_ajson(content: string): Map<string, EntityData | null> {
    const entries = new Map<string, EntityData | null>();

    // Wrap content in braces to parse as JSON object
    const wrapped = `{${content.trim().replace(/,$/, '')}}`;

    try {
      const parsed = JSON.parse(wrapped);

      for (const [full_key, data] of Object.entries(parsed)) {
        // Extract entity key from "collection_key:entity_key" format
        const [, entity_key] = full_key.split(':', 2);
        if (!entity_key) continue;

        entries.set(entity_key, data as EntityData | null);
      }
    } catch (error) {
      console.error('Error parsing AJSON:', error);
      console.error('Content:', wrapped.substring(0, 200));
    }

    return entries;
  }

  /**
   * Build AJSON line for an entity
   * Format: "collection_key:entity_key": data,
   */
  build_ajson_line(entity: T): string {
    return this.build_ajson_line_raw(entity.key, entity.data);
  }

  /**
   * Build AJSON line from raw key and data
   */
  build_ajson_line_raw(key: string, data: EntityData | null): string {
    const full_key = `${this.collection_key}:${key}`;
    const data_value = data === null ? 'null' : JSON.stringify(data);
    return `${JSON.stringify(full_key)}: ${data_value},`;
  }

  /**
   * Get file path for an entity key
   * Uses first part of path (before #) as filename
   */
  get_file_path(key: string): string {
    const file_name = this.key_to_filename(key);
    return `${this.collection.data_dir}/${file_name}.ajson`;
  }

  /**
   * Convert entity key to safe filename
   * Takes path before # and replaces special chars
   */
  key_to_filename(key: string): string {
    const base = key.split('#')[0];
    return base
      .replace(/\.md$/, '') // Remove .md extension first
      .replace(/[\s\/\.]/g, '_'); // Then replace special chars
  }

  /**
   * Get collection key
   */
  get collection_key(): string {
    return this._collection_key;
  }

  /**
   * Auto-detect collection key from first AJSON file
   * Parses first line to extract the prefix before ':'
   */
  async detect_collection_key(): Promise<string | null> {
    if (!this.fs_adapter) return null;

    try {
      // Check if directory exists
      if (!await this.dir_exists(this.collection.data_dir)) {
        return null;
      }

      const files = await this.list_ajson_files(this.collection.data_dir);
      if (files.length === 0) return null;

      const content = await this.read_file(files[0]);
      const first_line = content.trim().split('\n')[0];
      if (!first_line) return null;

      // Parse "collection_key:entity_key": data,
      const match = first_line.match(/^"([^:]+):/);
      if (match) return match[1];

      return null;
    } catch (error) {
      console.error('Error detecting collection key:', error);
      return null;
    }
  }

  // File system operations

  async dir_exists(path: string): Promise<boolean> {
    if (!this.fs_adapter) return false;
    try {
      return await this.fs_adapter.exists(path);
    } catch (error) {
      return false;
    }
  }

  async create_dir(path: string): Promise<void> {
    if (!this.fs_adapter) return;
    try {
      await this.fs_adapter.mkdir(path);
    } catch (error) {
      console.error(`Error creating directory ${path}:`, error);
    }
  }

  async file_exists(path: string): Promise<boolean> {
    if (!this.fs_adapter) return false;
    try {
      return await this.fs_adapter.exists(path);
    } catch (error) {
      return false;
    }
  }

  async list_ajson_files(dir: string): Promise<string[]> {
    if (!this.fs_adapter) return [];
    try {
      const listed = await this.fs_adapter.list(dir);
      // Obsidian's DataAdapter.list() returns full vault-relative paths
      return listed.files.filter(f => f.endsWith('.ajson'));
    } catch (error) {
      console.error(`Error listing AJSON files in ${dir}:`, error);
      return [];
    }
  }

  async read_file(path: string): Promise<string> {
    if (!this.fs_adapter) return '';
    try {
      return await this.fs_adapter.read(path);
    } catch (error) {
      console.error(`Error reading file ${path}:`, error);
      return '';
    }
  }

  async write_file(path: string, content: string): Promise<void> {
    if (!this.fs_adapter) return;
    try {
      await this.fs_adapter.write(path, content);
    } catch (error) {
      console.error(`Error writing file ${path}:`, error);
    }
  }
}
