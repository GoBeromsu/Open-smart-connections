/**
 * @file LinkedStrategy.ts
 * @description Linked context strategy using outlinks and backlinks
 * Uses MetadataCache.resolvedLinks to find connected notes
 */

import type {
  ContextStrategy,
  ContextParams,
  ContextItem,
} from '../../types/context';
import type { EntityCollection } from '../../entities/EntityCollection';
import type { EmbeddingEntity } from '../../entities/EmbeddingEntity';
import type { MetadataCache } from 'obsidian';
import { countTokens } from '../token-counter';

/**
 * Linked context strategy
 * Includes notes that are linked to/from the current note
 */
export class LinkedStrategy implements ContextStrategy {
  name = 'linked';
  priority = 1; // Medium priority
  default_enabled = true;

  /** Source collection reference */
  private source_collection: EntityCollection<EmbeddingEntity>;

  /** MetadataCache for link resolution */
  private metadata_cache?: MetadataCache;

  /** Maximum number of linked files to consider */
  private max_linked_files: number;

  constructor(
    source_collection: EntityCollection<EmbeddingEntity>,
    metadata_cache?: MetadataCache,
    max_linked_files: number = 15,
  ) {
    this.source_collection = source_collection;
    this.metadata_cache = metadata_cache;
    this.max_linked_files = max_linked_files;
  }

  /**
   * Count tokens for content
   */
  async count_tokens(content: string): Promise<number> {
    return countTokens(content);
  }

  /**
   * Gather linked context items
   * Gets notes that are linked to/from the target file
   */
  async gather(
    params: ContextParams,
    available_tokens: number,
  ): Promise<ContextItem[]> {
    const { target_path, filter } = params;

    if (!target_path || !this.metadata_cache) {
      return [];
    }

    const items: ContextItem[] = [];
    let tokens_used = 0;

    try {
      // Get linked file paths
      const linked_paths = this.get_linked_paths(target_path);

      // Filter and sort by link count
      const filtered_paths = linked_paths
        .filter((item) => {
          // Filter by include/exclude paths
          if (
            filter?.exclude_paths?.some((path) => item.path.startsWith(path))
          ) {
            return false;
          }
          if (
            filter?.include_paths &&
            !filter.include_paths.some((path) => item.path.startsWith(path))
          ) {
            return false;
          }
          return true;
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, this.max_linked_files);

      // Process each linked file
      for (const { path, direction } of filtered_paths) {
        // Get entity
        const entity = this.source_collection.get(path);
        if (!entity) {
          continue;
        }

        // Get content
        await entity.get_embed_input();
        const content = entity._embed_input || '';

        if (!content) {
          continue;
        }

        // Count tokens
        const item_tokens = await this.count_tokens(content);

        // Check budget
        if (tokens_used + item_tokens > available_tokens) {
          break;
        }

        // Add item
        items.push({
          key: entity.key,
          content,
          type: 'linked',
          tokens: item_tokens,
          entity,
          metadata: {
            link_direction: direction,
          },
        });

        tokens_used += item_tokens;
      }
    } catch (error) {
      console.error('Linked search failed:', error);
      return [];
    }

    return items;
  }

  /**
   * Get linked paths for a target file
   * Returns both outlinks and backlinks with their counts
   */
  private get_linked_paths(
    target_path: string,
  ): Array<{ path: string; count: number; direction: 'outlink' | 'backlink' }> {
    if (!this.metadata_cache) {
      return [];
    }

    const linked_paths: Array<{
      path: string;
      count: number;
      direction: 'outlink' | 'backlink';
    }> = [];
    const seen_paths = new Set<string>();

    // Get outlinks (files that target_path links to)
    const outlinks = this.metadata_cache.resolvedLinks[target_path] || {};
    for (const [path, count] of Object.entries(outlinks)) {
      if (!seen_paths.has(path)) {
        linked_paths.push({ path, count, direction: 'outlink' });
        seen_paths.add(path);
      }
    }

    // Get backlinks (files that link to target_path)
    for (const [source_path, links] of Object.entries(
      this.metadata_cache.resolvedLinks,
    )) {
      // Skip the target file itself
      if (source_path === target_path) {
        continue;
      }

      // Check if this source links to target_path
      if (links[target_path]) {
        if (!seen_paths.has(source_path)) {
          linked_paths.push({
            path: source_path,
            count: links[target_path],
            direction: 'backlink',
          });
          seen_paths.add(source_path);
        }
      }
    }

    return linked_paths;
  }
}
