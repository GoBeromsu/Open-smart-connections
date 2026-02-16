/**
 * @file context.ts
 * @description Type definitions for context system (LLM prompt building)
 * Strategy pattern for composable context gathering
 */

import type { EmbeddingEntity } from '../entities/EmbeddingEntity';

/**
 * Context item included in prompt
 */
export interface ContextItem {
  /** Item key (path or path#heading) */
  key: string;

  /** Item content/text */
  content: string;

  /** Item type (source, block, recent, linked, manual) */
  type: 'source' | 'block' | 'recent' | 'linked' | 'manual';

  /** Relevance score (if applicable) */
  score?: number;

  /** Token count for this item */
  tokens: number;

  /** The underlying entity (if applicable) */
  entity?: EmbeddingEntity;

  /** Additional metadata */
  metadata?: Record<string, any>;
}

/**
 * Context gathering parameters
 */
export interface ContextParams {
  /** Target file path (for recent/linked strategies) */
  target_path?: string;

  /** Query text (for semantic strategy) */
  query?: string;

  /** Maximum tokens to use for context */
  max_tokens: number;

  /** Token budget per strategy (optional overrides) */
  strategy_budgets?: Record<string, number>;

  /** Manually selected items (for manual strategy) */
  manual_selections?: string[];

  /** Minimum score threshold for semantic results */
  min_score?: number;

  /** Additional filter criteria */
  filter?: {
    exclude_paths?: string[];
    include_paths?: string[];
    file_types?: string[];
  };
}

/**
 * Context gathering result
 */
export interface ContextResult {
  /** Context items to include in prompt */
  items: ContextItem[];

  /** Total tokens used */
  total_tokens: number;

  /** Tokens used per strategy */
  tokens_by_strategy: Record<string, number>;

  /** Items that were truncated due to token limit */
  truncated_items?: string[];

  /** Metadata about the context gathering */
  metadata?: {
    strategies_used: string[];
    semantic_query?: string;
    target_path?: string;
    duration_ms?: number;
  };
}

/**
 * Context strategy interface
 * Each strategy implements a different way to gather context
 */
export interface ContextStrategy {
  /** Strategy name (semantic, recent, linked, manual) */
  name: string;

  /** Strategy priority (higher = runs first) */
  priority: number;

  /** Whether this strategy is enabled by default */
  default_enabled: boolean;

  /**
   * Gather context items using this strategy
   * @param params Context gathering parameters
   * @param available_tokens Tokens still available in budget
   * @returns Context items from this strategy
   */
  gather(params: ContextParams, available_tokens: number): Promise<ContextItem[]>;

  /**
   * Estimate token count for content
   * @param content Text content
   * @returns Estimated token count
   */
  count_tokens(content: string): Promise<number>;
}

/**
 * Context manager configuration
 */
export interface ContextManagerConfig {
  /** Available strategies */
  strategies: ContextStrategy[];

  /** Default max tokens */
  default_max_tokens: number;

  /** Strategy priorities (override defaults) */
  strategy_priorities?: Record<string, number>;

  /** Token counter function */
  token_counter?: (text: string) => Promise<number>;
}
