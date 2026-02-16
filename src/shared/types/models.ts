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
