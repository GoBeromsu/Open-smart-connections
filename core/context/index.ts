/**
 * @file index.ts
 * @description Barrel exports for context system
 */

// Core manager
export { ContextManager } from './ContextManager';

// Token counting
export { countTokens, freeEncoder } from './token-counter';

// Strategies
export { ManualStrategy } from './strategies/ManualStrategy';
export { SemanticStrategy } from './strategies/SemanticStrategy';
export { RecentStrategy } from './strategies/RecentStrategy';
export { LinkedStrategy } from './strategies/LinkedStrategy';

// Re-export types from core/types/context
export type {
  ContextStrategy,
  ContextParams,
  ContextResult,
  ContextItem,
  ContextManagerConfig,
} from '../types/context';
