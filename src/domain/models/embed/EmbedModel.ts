/**
 * @file EmbedModel.ts
 * @description Base embedding model class with adapter pattern
 */

import type { EmbedInput, EmbedResult, EmbedModelAdapter } from '../../../types/models';

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
   * Generate embeddings for multiple inputs in batch
   * @param inputs - Array of texts or objects with embed_input
   * @returns Array of embedding results
   */
  async embed_batch(inputs: (EmbedInput | { _embed_input: string })[]): Promise<EmbedResult[]> {
    return await this.adapter.embed_batch(inputs);
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
