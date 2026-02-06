/**
 * @file index.ts
 * @description Barrel exports for all core types
 * Import from 'core/types' to get all type definitions
 */

// Settings types
export type {
  EmbedModelSettings,
  ChatModelSettings,
  SourceSettings,
  BlockSettings,
  ViewFilterSettings,
  ChatSettings,
  PluginSettings,
} from './settings';

// Entity types
export type {
  LastMetadata,
  EmbeddingData,
  EntityData,
  SourceData,
  BlockData,
  ConnectionResult,
  EmbeddingEntity,
  SearchFilter,
} from './entities';

// Model types
export type {
  ModelInfo,
  EmbedInput,
  EmbedResult,
  EmbedModelAdapter,
  ChatModelAdapter,
  ChatMessage,
  ToolCall,
  ToolDefinition,
  ChatRequest as ModelChatRequest,
  ChatResponse,
  StreamHandlers,
} from './models';

// Context types
export type {
  ContextItem,
  ContextParams,
  ContextResult,
  ContextStrategy,
  ContextManagerConfig,
} from './context';

// Chat types
export type {
  ChatRequest,
  ChatThread,
  ChatHistoryEntry,
  ChatUIState,
} from './chat';
