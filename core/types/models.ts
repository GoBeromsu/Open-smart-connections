/**
 * @file models.ts
 * @description Type definitions for AI model adapters (chat and embed)
 */

/**
 * Model information
 */
export interface ModelInfo {
  /** Model identifier/key */
  model_key: string;

  /** Model name (display) */
  model_name?: string;

  /** Model description */
  description?: string;

  /** Max tokens this model supports */
  max_tokens?: number;

  /** Embedding dimensions (for embed models) */
  dims?: number;

  /** API endpoint override (for remote adapters) */
  endpoint?: string;

  /** Recommended batch size */
  batch_size?: number;

  /** Whether model supports streaming (for chat models) */
  streaming?: boolean;

  /** Whether model supports tools/function calling */
  supports_tools?: boolean;

  /** Context window size */
  context_window?: number;

  /** Pricing information */
  pricing?: {
    input?: number;
    output?: number;
  };
}

/**
 * Embed input for batch embedding
 */
export interface EmbedInput {
  /** Input text to embed */
  embed_input: string;

  /** Optional entity key for tracking */
  key?: string;

  /** Optional index in batch */
  index?: number;
}

/**
 * Embed result from model
 */
export interface EmbedResult {
  /** Embedding vector */
  vec?: number[];

  /** Token count (if available) */
  tokens?: number;

  /** Optional entity key */
  key?: string;

  /** Optional index in batch */
  index?: number;

  /** Adapter-specific error payload */
  error?: {
    message?: string;
    details?: any;
    [key: string]: any;
  };
}

/**
 * Embed model adapter interface
 */
export interface EmbedModelAdapter {
  /** Adapter name (openai, transformers, ollama, etc.) */
  adapter: string;

  /** Model key/identifier */
  model_key: string;

  /** Embedding dimensions */
  dims: number;

  /** Available models */
  models: Record<string, ModelInfo>;

  /** Model configuration settings */
  settings: any;

  /**
   * Embed a batch of inputs
   */
  embed_batch(inputs: Array<EmbedInput | { _embed_input: string }>): Promise<EmbedResult[]>;

  /**
   * Get model information
   */
  get_model_info(model_key?: string): ModelInfo | undefined;

  /**
   * Count tokens in input text
   */
  count_tokens(input: string): Promise<number>;

  /**
   * Test API connection/key
   */
  test_api_key?(): Promise<void>;

  /**
   * Unload model (for local models)
   */
  unload?(): Promise<void>;
}

/**
 * Chat model adapter interface
 */
export interface ChatModelAdapter {
  /** Adapter name (openai, anthropic, ollama, etc.) */
  adapter: string;

  /** Model key/identifier */
  model_key: string;

  /** Available models */
  models: Record<string, ModelInfo>;

  /** Model configuration settings */
  settings: any;

  /** Whether adapter supports streaming */
  can_stream: boolean;

  /**
   * Complete a chat request
   */
  complete(req: ChatRequest): Promise<ChatResponse>;

  /**
   * Stream a chat response
   */
  stream?(req: ChatRequest, handlers: StreamHandlers): Promise<string>;

  /**
   * Stop active stream
   */
  stop_stream?(): void;

  /**
   * Count tokens in input
   */
  count_tokens(input: string | object): Promise<number>;

  /**
   * Test API connection/key
   */
  test_api_key?(): Promise<void>;
}

/**
 * Chat message
 */
export interface ChatMessage {
  /** Message role (system, user, assistant, tool) */
  role: 'system' | 'user' | 'assistant' | 'tool';

  /** Message content */
  content: string;

  /** Tool calls (for assistant messages) */
  tool_calls?: ToolCall[];

  /** Tool call ID (for tool messages) */
  tool_call_id?: string;

  /** Message name (for tool messages) */
  name?: string;
}

/**
 * Tool call in chat message
 */
export interface ToolCall {
  /** Tool call ID */
  id: string;

  /** Tool name */
  name: string;

  /** Tool arguments (JSON string) */
  arguments: string;
}

/**
 * Tool definition for chat
 */
export interface ToolDefinition {
  /** Tool name */
  name: string;

  /** Tool description */
  description: string;

  /** Parameters schema (JSON Schema) */
  parameters: Record<string, any>;
}

/**
 * Chat request
 */
export interface ChatRequest {
  /** Messages in conversation */
  messages: ChatMessage[];

  /** Model key override */
  model_key?: string;

  /** Max tokens to generate */
  max_tokens?: number;

  /** Temperature (0-1) */
  temperature?: number;

  /** Top P sampling */
  top_p?: number;

  /** Stop sequences */
  stop?: string[];

  /** Available tools */
  tools?: ToolDefinition[];

  /** Stream response */
  stream?: boolean;

  /** Additional model-specific parameters */
  [key: string]: any;
}

/**
 * Chat response
 */
export interface ChatResponse {
  /** Generated message */
  message?: ChatMessage;

  /** Full text response */
  text?: string;

  /** Tool calls in response */
  tool_calls?: ToolCall[];

  /** Token usage */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };

  /** Error if request failed */
  error?: string | Error;

  /** Finish reason */
  finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

/**
 * Stream handlers for streaming chat
 */
export interface StreamHandlers {
  /** Called when stream starts */
  onOpen?(): void;

  /** Called for each chunk */
  onChunk?(chunk: string): void;

  /** Called when stream finishes */
  onClose?(fullText: string): void;

  /** Called on error */
  onError?(error: Error): void;
}
