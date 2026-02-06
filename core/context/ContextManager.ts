/**
 * @file ContextManager.ts
 * @description Orchestrates context gathering strategies
 * Manages multiple strategies, token budgets, and deduplication
 */

import type {
  ContextStrategy,
  ContextParams,
  ContextResult,
  ContextItem,
} from '../types/context';
import { countTokens } from './token-counter';

/**
 * Context manager
 * Orchestrates multiple context strategies with token budget management
 */
export class ContextManager {
  /** Registered strategies */
  private strategies: Map<string, ContextStrategy> = new Map();

  /** Custom token counter (optional override) */
  private token_counter?: (text: string) => Promise<number>;

  constructor() {
    // Default token counter from token-counter.ts
    this.token_counter = countTokens;
  }

  /**
   * Register a context strategy
   * Strategies with higher priority run first
   */
  registerStrategy(strategy: ContextStrategy): void {
    this.strategies.set(strategy.name, strategy);
  }

  /**
   * Unregister a strategy
   */
  unregisterStrategy(name: string): void {
    this.strategies.delete(name);
  }

  /**
   * Set custom token counter function
   */
  setTokenCounter(fn: (text: string) => Promise<number>): void {
    this.token_counter = fn;

    // Update strategies to use this counter
    const strategies = Array.from(this.strategies.values());
    for (const strategy of strategies) {
      strategy.count_tokens = fn;
    }
  }

  /**
   * Gather context from all enabled strategies
   * Manages token budget and deduplicates results
   */
  async gather(params: ContextParams): Promise<ContextResult> {
    const start_time = Date.now();
    const { max_tokens, strategy_budgets = {} } = params;

    // Get enabled strategies sorted by priority (highest first)
    const enabled_strategies = Array.from(this.strategies.values())
      .filter((s) => s.default_enabled)
      .sort((a, b) => b.priority - a.priority);

    if (enabled_strategies.length === 0) {
      return {
        items: [],
        total_tokens: 0,
        tokens_by_strategy: {},
        metadata: {
          strategies_used: [],
          duration_ms: Date.now() - start_time,
        },
      };
    }

    // Allocate token budget to strategies
    const budgets = this.allocate_budgets(
      enabled_strategies,
      max_tokens,
      strategy_budgets,
    );

    // Gather context from each strategy
    const all_items: ContextItem[] = [];
    const tokens_by_strategy: Record<string, number> = {};
    const strategies_used: string[] = [];
    const seen_keys = new Set<string>();

    for (const strategy of enabled_strategies) {
      const available_tokens = budgets[strategy.name] || 0;

      if (available_tokens <= 0) {
        continue;
      }

      try {
        // Gather items from this strategy
        const strategy_items = await strategy.gather(params, available_tokens);

        // Deduplicate and add items
        let tokens_used = 0;
        for (const item of strategy_items) {
          // Skip if already seen (deduplication by key)
          if (seen_keys.has(item.key)) {
            continue;
          }

          all_items.push(item);
          seen_keys.add(item.key);
          tokens_used += item.tokens;
        }

        if (strategy_items.length > 0) {
          tokens_by_strategy[strategy.name] = tokens_used;
          strategies_used.push(strategy.name);
        }
      } catch (error) {
        console.error(`Strategy ${strategy.name} failed:`, error);
        // Continue with other strategies
      }
    }

    // Calculate total tokens
    const total_tokens = all_items.reduce((sum, item) => sum + item.tokens, 0);

    // Check if we exceeded budget (should not happen, but just in case)
    const truncated_items: string[] = [];
    if (total_tokens > max_tokens) {
      console.warn(
        `Context exceeds token budget: ${total_tokens} > ${max_tokens}`,
      );
      // Truncate items to fit budget
      const { items: fitted_items, truncated } = this.fit_to_budget(
        all_items,
        max_tokens,
      );
      truncated_items.push(...truncated);

      return {
        items: fitted_items,
        total_tokens: fitted_items.reduce((sum, item) => sum + item.tokens, 0),
        tokens_by_strategy,
        truncated_items,
        metadata: {
          strategies_used,
          semantic_query: params.query,
          target_path: params.target_path,
          duration_ms: Date.now() - start_time,
        },
      };
    }

    return {
      items: all_items,
      total_tokens,
      tokens_by_strategy,
      metadata: {
        strategies_used,
        semantic_query: params.query,
        target_path: params.target_path,
        duration_ms: Date.now() - start_time,
      },
    };
  }

  /**
   * Allocate token budget to strategies
   * Respects custom budgets and distributes remaining tokens by priority
   */
  private allocate_budgets(
    strategies: ContextStrategy[],
    max_tokens: number,
    custom_budgets: Record<string, number>,
  ): Record<string, number> {
    const budgets: Record<string, number> = {};
    let remaining_tokens = max_tokens;

    // First, allocate custom budgets
    for (const strategy of strategies) {
      if (custom_budgets[strategy.name]) {
        budgets[strategy.name] = Math.min(
          custom_budgets[strategy.name],
          remaining_tokens,
        );
        remaining_tokens -= budgets[strategy.name];
      }
    }

    // Then, distribute remaining tokens by priority
    const strategies_without_budget = strategies.filter(
      (s) => !custom_budgets[s.name],
    );

    if (strategies_without_budget.length > 0 && remaining_tokens > 0) {
      // Calculate total priority weight
      const total_priority = strategies_without_budget.reduce(
        (sum, s) => sum + s.priority,
        0,
      );

      // Distribute tokens proportionally to priority
      for (const strategy of strategies_without_budget) {
        const proportion = strategy.priority / total_priority;
        budgets[strategy.name] = Math.floor(remaining_tokens * proportion);
      }
    }

    return budgets;
  }

  /**
   * Fit items to token budget by truncating if necessary
   * Preserves priority order (items from higher priority strategies first)
   */
  private fit_to_budget(
    items: ContextItem[],
    max_tokens: number,
  ): { items: ContextItem[]; truncated: string[] } {
    const fitted_items: ContextItem[] = [];
    const truncated: string[] = [];
    let tokens_used = 0;

    // Sort by priority (manual > semantic > recent/linked)
    const priority_order = { manual: 3, semantic: 2, recent: 1, linked: 1, source: 0, block: 0 };
    const sorted_items = [...items].sort((a, b) => {
      const a_priority = priority_order[a.type] || 0;
      const b_priority = priority_order[b.type] || 0;
      return b_priority - a_priority;
    });

    for (const item of sorted_items) {
      if (tokens_used + item.tokens <= max_tokens) {
        fitted_items.push(item);
        tokens_used += item.tokens;
      } else {
        truncated.push(item.key);
      }
    }

    return { items: fitted_items, truncated };
  }

  /**
   * Get list of registered strategies
   */
  getStrategies(): ContextStrategy[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Get a specific strategy by name
   */
  getStrategy(name: string): ContextStrategy | undefined {
    return this.strategies.get(name);
  }

  /**
   * Clear all strategies
   */
  clear(): void {
    this.strategies.clear();
  }
}
