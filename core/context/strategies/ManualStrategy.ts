/**
 * @file ManualStrategy.ts
 * @description Manual context strategy for user-selected items (@ mentions)
 * Highest priority - always included if selected
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
 * Manual context strategy
 * Includes explicitly selected items via @ mentions or UI selection
 */
export class ManualStrategy implements ContextStrategy {
  name = 'manual';
  priority = 3; // Highest priority
  default_enabled = true;

  /** Source collection reference */
  private source_collection?: EntityCollection<EmbeddingEntity>;

  /** Block collection reference */
  private block_collection?: EntityCollection<EmbeddingEntity>;

  constructor(
    source_collection?: EntityCollection<EmbeddingEntity>,
    block_collection?: EntityCollection<EmbeddingEntity>,
  ) {
    this.source_collection = source_collection;
    this.block_collection = block_collection;
  }

  /**
   * Count tokens for content
   */
  async count_tokens(content: string): Promise<number> {
    return countTokens(content);
  }

  /**
   * Gather manually selected context items
   * These are always included if selected (highest priority)
   */
  async gather(
    params: ContextParams,
    available_tokens: number,
  ): Promise<ContextItem[]> {
    const { manual_selections } = params;

    if (!manual_selections || manual_selections.length === 0) {
      return [];
    }

    const items: ContextItem[] = [];
    let tokens_used = 0;

    // Process each manual selection
    for (const key of manual_selections) {
      // Try to find entity in collections
      let entity: EmbeddingEntity | undefined;
      let content = '';

      // Check if it's a block (contains #) or source
      if (key.includes('#')) {
        entity = this.block_collection?.get(key);
      } else {
        entity = this.source_collection?.get(key);
      }

      // Get content
      if (entity) {
        content = await this.get_entity_content(entity);
      } else {
        // If entity not found, skip
        console.warn(`Manual selection not found: ${key}`);
        continue;
      }

      // Count tokens
      const item_tokens = await this.count_tokens(content);

      // Check if we have budget
      if (tokens_used + item_tokens > available_tokens) {
        console.warn(
          `Manual selection ${key} exceeds token budget (${item_tokens} tokens)`,
        );
        continue;
      }

      // Add to results
      items.push({
        key,
        content,
        type: 'manual',
        tokens: item_tokens,
        entity,
      });

      tokens_used += item_tokens;
    }

    return items;
  }

  /**
   * Get content from entity
   */
  private async get_entity_content(entity: EmbeddingEntity): Promise<string> {
    // Get embed input (formatted content)
    await entity.get_embed_input();
    return entity._embed_input || '';
  }
}
