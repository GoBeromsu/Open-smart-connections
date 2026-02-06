/**
 * @file _adapter.ts
 * @description Base adapter class for chat models
 * Simplified version without SmartModel dependencies
 */

import type { ChatRequest, ChatResponse, StreamHandlers, ModelInfo } from '../../../types/models';

export interface AdapterConfig {
  /** API key */
  api_key?: string;

  /** Model key */
  model_key?: string;

  /** Additional adapter-specific settings */
  [key: string]: any;
}

export interface AdapterDefaults {
  /** Adapter description */
  description?: string;

  /** Adapter type */
  type?: string;

  /** API endpoint */
  endpoint?: string;

  /** Streaming support */
  streaming?: boolean;

  /** API key header name */
  api_key_header?: string;

  /** Default headers */
  headers?: Record<string, string>;

  /** Models endpoint */
  models_endpoint?: string | false;

  /** Default model */
  default_model?: string;

  /** Signup URL */
  signup_url?: string;

  /** API host */
  host?: string;

  [key: string]: any;
}

/**
 * Base adapter class for chat models
 */
export abstract class ChatModelAdapter {
  /** Adapter defaults */
  static defaults: AdapterDefaults = {};

  /** Adapter key/name */
  static key?: string;

  /** Model key */
  model_key: string;

  /** Available models */
  models: Record<string, ModelInfo> = {};

  /** Model settings */
  settings: AdapterConfig;

  /** Whether adapter supports streaming */
  can_stream: boolean = false;

  constructor(settings: AdapterConfig) {
    this.settings = settings;
    const defaults = (this.constructor as typeof ChatModelAdapter).defaults;
    this.model_key = settings.model_key || defaults.default_model || '';
    this.can_stream = defaults.streaming || false;
  }

  /**
   * Get adapter name
   */
  get adapter(): string {
    return (this.constructor as typeof ChatModelAdapter).key || 'unknown';
  }

  /**
   * Complete a chat request
   */
  abstract complete(req: ChatRequest): Promise<ChatResponse>;

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
  abstract count_tokens(input: string | object): Promise<number>;

  /**
   * Test API connection/key
   */
  test_api_key?(): Promise<void>;

  /**
   * Get API key from settings
   */
  protected get api_key(): string | undefined {
    return this.settings.api_key;
  }

  /**
   * Validate API key exists
   */
  protected validate_api_key(): void {
    if (!this.api_key) {
      throw new Error(`API key required for ${this.adapter} adapter`);
    }
  }

  /**
   * Get models (for adapters with dynamic model lists)
   */
  async get_models(refresh?: boolean): Promise<Record<string, ModelInfo>> {
    return this.models;
  }
}
