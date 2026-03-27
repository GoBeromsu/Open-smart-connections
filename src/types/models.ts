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

  /** Approximate ONNX quantized model size in MB */
  size_mb?: number;

  /** URL to sign up for API key */
  signup_url?: string;

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

  /** Tokenizer configuration for token counting */
  tokenizer?: TokenizerConfig;
}

/**
 * Tokenizer strategy type.
 * - 'tiktoken': js-tiktoken based (for OpenAI models with known encoding)
 * - 'char-estimate': character count based estimation (when exact tokenizer unavailable)
 */
export type TokenizerType = 'tiktoken' | 'char-estimate';

/**
 * Tokenizer configuration embedded in ModelInfo.
 * Declares how token counting should work for this specific model.
 */
export interface TokenizerConfig {
  /** Tokenizer implementation type */
  type: TokenizerType;
  /** For tiktoken: encoding name (e.g., 'cl100k_base') */
  model_id?: string;
  /** For char-estimate: characters per token ratio. Lower = more conservative. Default: 3.7 */
  chars_per_token?: number;
  /** Safety ratio applied to max_tokens for effective budget. Range 0-1. Default: 0.85 */
  safety_ratio?: number;
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
    details?: unknown;
    [key: string]: unknown;
  };
}

/**
 * Configuration object passed to adapter constructors
 */
export interface AdapterConfig {
  adapter: string;
  model_key: string;
  dims: number;
  models: Record<string, ModelInfo>;
  settings: Record<string, unknown>;
  host?: string;
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
  settings: Record<string, unknown>;

  /**
   * Embed a batch of inputs
   */
  embed_batch(inputs: Array<EmbedInput | { _embed_input: string }>): Promise<EmbedResult[]>;

  /**
   * Embed a search query. Uses query-specific model when available
   * (e.g., Upstage embedding-query vs embedding-passage).
   */
  embed_query?(query: string): Promise<EmbedResult[]>;

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
