/**
 * @file ChatModel.ts
 * @description Base class for chat model management
 * Simplified version without SmartModel dependencies
 */

import type { ChatModelAdapter, ChatRequest, ChatResponse, StreamHandlers } from '../../types/models';

export interface ChatModelConfig {
  /** Adapter name (openai, anthropic, ollama, etc.) */
  adapter: string;

  /** Available adapters */
  adapters: Record<string, new (config: any) => ChatModelAdapter>;

  /** Model configuration settings */
  settings: Record<string, any>;
}

/**
 * ChatModel - Main class for handling chat operations
 * Manages adapter selection and delegates to platform-specific adapters
 */
export class ChatModel {
  private config: ChatModelConfig;
  private _adapter: ChatModelAdapter | null = null;

  constructor(config: ChatModelConfig) {
    this.config = config;
  }

  /**
   * Get current adapter instance
   */
  get adapter(): ChatModelAdapter {
    if (!this._adapter) {
      const AdapterClass = this.config.adapters[this.config.adapter];
      if (!AdapterClass) {
        throw new Error(`Adapter not found: ${this.config.adapter}`);
      }
      this._adapter = new AdapterClass(this.config.settings);
    }
    return this._adapter;
  }

  /**
   * Get available models
   */
  get models(): Record<string, any> {
    return this.adapter.models;
  }

  /**
   * Check if adapter supports streaming
   */
  get can_stream(): boolean {
    return this.adapter.can_stream;
  }

  /**
   * Complete a chat request
   */
  async complete(req: ChatRequest): Promise<ChatResponse> {
    return await this.adapter.complete(req);
  }

  /**
   * Stream chat responses
   */
  async stream(req: ChatRequest, handlers: StreamHandlers = {}): Promise<string> {
    if (!this.adapter.stream) {
      throw new Error(`Streaming not supported by adapter: ${this.config.adapter}`);
    }
    return await this.adapter.stream(req, handlers);
  }

  /**
   * Stop active stream
   */
  stop_stream(): void {
    if (this.adapter.stop_stream) {
      this.adapter.stop_stream();
    }
  }

  /**
   * Count tokens in input
   */
  async count_tokens(input: string | object): Promise<number> {
    return await this.adapter.count_tokens(input);
  }

  /**
   * Test API key/connection
   */
  async test_api_key(): Promise<void> {
    if (this.adapter.test_api_key) {
      await this.adapter.test_api_key();
    }
  }

  /**
   * Change adapter
   */
  set_adapter(adapter_name: string): void {
    this.config.adapter = adapter_name;
    this._adapter = null; // Reset adapter to force reinitialization
  }

  /**
   * Update settings
   */
  update_settings(settings: Record<string, any>): void {
    this.config.settings = { ...this.config.settings, ...settings };
    this._adapter = null; // Reset adapter to pick up new settings
  }
}
