/**
 * @file RecentStrategy.ts
 * @description Recent context strategy based on file modification time
 * Uses MetadataCache mtime to find recently modified files
 */

import type {
  ContextStrategy,
  ContextParams,
  ContextItem,
} from '../../types/context';
import type { EntityCollection } from '../../entities/EntityCollection';
import type { EmbeddingEntity } from '../../entities/EmbeddingEntity';
import { countTokens } from '../token-counter';

/**
 * Recent context strategy
 * Includes recently modified files based on mtime
 */
export class RecentStrategy implements ContextStrategy {
  name = 'recent';
  priority = 1; // Medium priority
  default_enabled = true;

  /** Source collection reference */
  private source_collection: EntityCollection<EmbeddingEntity>;

  /** Maximum number of recent files to consider */
  private max_recent_files: number;

  constructor(
    source_collection: EntityCollection<EmbeddingEntity>,
    max_recent_files: number = 10,
  ) {
    this.source_collection = source_collection;
    this.max_recent_files = max_recent_files;
  }

  /**
   * Count tokens for content
   */
  async count_tokens(content: string): Promise<number> {
    return countTokens(content);
  }

  /**
   * Gather recent context items
   * Gets recently modified files from the vault
   */
  async gather(
    params: ContextParams,
    available_tokens: number,
  ): Promise<ContextItem[]> {
    const { filter } = params;

    const items: ContextItem[] = [];
    let tokens_used = 0;

    try {
      // Get all sources with mtime
      const sources_with_mtime = this.source_collection.all
        .filter((source) => {
          // Filter by include/exclude paths
          if (filter?.exclude_paths?.some((path) => source.key.startsWith(path))) {
            return false;
          }
          if (
            filter?.include_paths &&
            !filter.include_paths.some((path) => source.key.startsWith(path))
          ) {
            return false;
          }

          // Must have mtime
          return source.data.mtime !== undefined;
        })
        .map((source) => ({
          entity: source,
          mtime: source.data.mtime || 0,
        }));

      // Sort by mtime (most recent first)
      sources_with_mtime.sort((a, b) => b.mtime - a.mtime);

      // Take top N recent files
      const recent_sources = sources_with_mtime
        .slice(0, this.max_recent_files)
        .map((item) => item.entity);

      // Process each recent file
      for (const entity of recent_sources) {
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
          type: 'recent',
          tokens: item_tokens,
          entity,
          metadata: {
            mtime: entity.data.mtime,
          },
        });

        tokens_used += item_tokens;
      }
    } catch (error) {
      console.error('Recent search failed:', error);
      return [];
    }

    return items;
  }
}
