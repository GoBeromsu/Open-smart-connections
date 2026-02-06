/**
 * @file EmbedModel.ts
 * @description Base embedding model class with adapter pattern
 */

import type { EmbedInput, EmbedResult, EmbedModelAdapter, ModelInfo } from '../../types/models';

/**
 * Configuration options for EmbedModel
 */
export interface EmbedModelOptions {
  /** Adapter instance to use */
  adapter: EmbedModelAdapter;

  /** Model key/identifier */
  model_key?: string;

  /** Settings object */
  settings?: any;

  /** Additional data */
  [key: string]: any;
}

/**
 * EmbedModel - Versatile class for handling text embeddings using various model backends
 * Supports both cloud-based APIs and local transformers models
 */
export class EmbedModel {
  adapter: EmbedModelAdapter;
  model_key: string;
  settings: any;
  data: any;

  /**
   * Create an EmbedModel instance
   * @param opts - Configuration options
   */
  constructor(opts: EmbedModelOptions) {
    this.adapter = opts.adapter;
    this.model_key = opts.model_key || this.adapter.model_key;
    this.settings = opts.settings || {};
    this.data = opts;
  }

  /**
   * Count tokens in an input string
   * @param input - Text to tokenize
   * @returns Token count
   */
  async count_tokens(input: string): Promise<number> {
    return await this.adapter.count_tokens(input);
  }

  /**
   * Generate embeddings for a single input
   * @param input - Text or object with embed_input property
   * @returns Embedding result
   */
  async embed(input: string | EmbedInput): Promise<EmbedResult> {
    if (typeof input === 'string') {
      input = { embed_input: input };
    }
    const results = await this.embed_batch([input]);
    return results[0];
  }

  /**
   * Generate embeddings for multiple inputs in batch
   * @param inputs - Array of texts or objects with embed_input
   * @returns Array of embedding results
   */
  async embed_batch(inputs: (EmbedInput | { _embed_input: string })[]): Promise<EmbedResult[]> {
    return await this.adapter.embed_batch(inputs);
  }

  /**
   * Get the current batch size based on adapter settings
   * @returns Current batch size for processing
   */
  get batch_size(): number {
    return this.adapter.dims || 1;
  }

  /**
   * Get model information
   * @param model_key - Optional model key override
   * @returns Model information
   */
  get_model_info(model_key?: string): ModelInfo | undefined {
    return this.adapter.get_model_info(model_key);
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
   * Unload model (for local models)
   */
  async unload(): Promise<void> {
    if (this.adapter.unload) {
      await this.adapter.unload();
    }
  }
}
