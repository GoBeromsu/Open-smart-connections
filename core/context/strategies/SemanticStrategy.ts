/**
 * @file SemanticStrategy.ts
 * @description Semantic context strategy using embedding-based search
 * Queries both sources and blocks for semantically relevant context
 */

import type {
  ContextStrategy,
  ContextParams,
  ContextItem,
} from '../../types/context';
import type { EntityCollection } from '../../entities/EntityCollection';
import type { EmbeddingEntity } from '../../entities/EmbeddingEntity';
import type { ConnectionResult } from '../../types/entities';
import type { EmbedModelAdapter } from '../../types/models';
import { lookup } from '../../search/lookup';
import { countTokens } from '../token-counter';

/**
 * Semantic context strategy
 * Uses vector search to find relevant context based on query
 */
export class SemanticStrategy implements ContextStrategy {
  name = 'semantic';
  priority = 2; // High priority
  default_enabled = true;

  /** Embedding model for query embedding */
  private embed_model: EmbedModelAdapter;

  /** Source collection reference */
  private source_collection: EntityCollection<EmbeddingEntity>;

  /** Block collection reference (optional) */
  private block_collection?: EntityCollection<EmbeddingEntity>;

  constructor(
    embed_model: EmbedModelAdapter,
    source_collection: EntityCollection<EmbeddingEntity>,
    block_collection?: EntityCollection<EmbeddingEntity>,
  ) {
    this.embed_model = embed_model;
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
   * Gather semantic context items
   * Searches both sources and blocks (if enabled) for relevant context
   */
  async gather(
    params: ContextParams,
    available_tokens: number,
  ): Promise<ContextItem[]> {
    const { query, min_score = 0.5, filter } = params;

    if (!query || query.trim().length === 0) {
      return [];
    }

    const items: ContextItem[] = [];
    let tokens_used = 0;

    // Determine budget split: 60% blocks, 40% sources (if blocks enabled)
    const use_blocks = !!this.block_collection;
    const block_budget = use_blocks
      ? Math.floor(available_tokens * 0.6)
      : 0;
    const source_budget = available_tokens - block_budget;

    try {
      // Search blocks first (more granular)
      if (use_blocks && block_budget > 0 && this.block_collection) {
        const block_results = await lookup(
          query,
          this.embed_model,
          this.block_collection.all,
          {
            limit: 20,
            min_score,
            exclude: filter?.exclude_paths,
            include: filter?.include_paths,
            key_starts_with: filter?.include_paths?.[0],
            blocks_only: true,
          },
        );

        const block_items = await this.process_results(
          block_results,
          'block',
          block_budget,
        );
        items.push(...block_items);
        tokens_used += block_items.reduce((sum, item) => sum + item.tokens, 0);
      }

      // Search sources
      if (source_budget > 0) {
        const source_results = await lookup(
          query,
          this.embed_model,
          this.source_collection.all,
          {
            limit: 10,
            min_score,
            exclude: filter?.exclude_paths,
            include: filter?.include_paths,
            key_starts_with: filter?.include_paths?.[0],
            sources_only: true,
          },
        );

        const source_items = await this.process_results(
          source_results,
          'source',
          source_budget,
        );
        items.push(...source_items);
        tokens_used += source_items.reduce((sum, item) => sum + item.tokens, 0);
      }
    } catch (error) {
      console.error('Semantic search failed:', error);
      return [];
    }

    return items;
  }

  /**
   * Process search results into context items
   */
  private async process_results(
    results: ConnectionResult[],
    type: 'source' | 'block',
    token_budget: number,
  ): Promise<ContextItem[]> {
    const items: ContextItem[] = [];
    let tokens_used = 0;

    for (const result of results) {
      // Get content
      const entity = result.item;
      await entity.get_embed_input();
      const content = entity._embed_input || '';

      if (!content) {
        continue;
      }

      // Count tokens
      const item_tokens = await this.count_tokens(content);

      // Check budget
      if (tokens_used + item_tokens > token_budget) {
        break;
      }

      // Add item
      items.push({
        key: entity.key,
        content,
        type,
        score: result.score,
        tokens: item_tokens,
        entity,
      });

      tokens_used += item_tokens;
    }

    return items;
  }
}
