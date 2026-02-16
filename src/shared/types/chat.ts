/**
 * @file chat.ts
 * @description Type definitions for chat interface
 * Re-exports some types from models.ts and adds chat-specific types
 */

import type { ChatMessage, ChatRequest as ModelChatRequest, ChatResponse, ToolCall, ToolDefinition } from './models';

// Re-export core types
export type { ChatMessage, ChatResponse, ToolCall, ToolDefinition };

/**
 * Chat request (extends model request with UI-specific fields)
 */
export interface ChatRequest extends ModelChatRequest {
  /** Thread ID this message belongs to */
  thread_id?: string;

  /** Whether to include context automatically */
  include_context?: boolean;

  /** Context gathering parameters */
  context_params?: {
    max_tokens?: number;
    strategies?: string[];
    manual_selections?: string[];
  };
}

/**
 * Chat thread
 */
export interface ChatThread {
  /** Thread ID */
  id: string;

  /** Thread title/name */
  name: string;

  /** Messages in thread */
  messages: ChatMessage[];

  /** Thread creation time */
  created_at: number;

  /** Last updated time */
  updated_at: number;

  /** Thread metadata */
  metadata?: {
    model_key?: string;
    context_items?: string[];
    total_tokens?: number;
  };
}

/**
 * Chat history entry (for persistence)
 */
export interface ChatHistoryEntry {
  /** Entry ID */
  id: string;

  /** Thread this entry belongs to */
  thread_id: string;

  /** Message */
  message: ChatMessage;

  /** Context included with this message */
  context?: string[];

  /** Timestamp */
  timestamp: number;

  /** Token usage */
  tokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

/**
 * Chat UI state
 */
export interface ChatUIState {
  /** Currently active thread */
  active_thread_id: string | null;

  /** Whether chat is streaming */
  is_streaming: boolean;

  /** Current input text */
  input_text: string;

  /** Manual context selections */
  selected_context: string[];

  /** UI preferences */
  preferences: {
    render_markdown: boolean;
    show_context: boolean;
    auto_scroll: boolean;
  };
}
