/**
 * @file _api.ts
 * @description Base adapter classes for API-based embedding models
 */

import { requestUrl } from 'obsidian';
import type { EmbedInput, EmbedResult, ModelInfo } from '../../../types/models';
import { TransientError, FatalError } from '../../../errors';

/**
 * Base adapter class for API-based embedding models (e.g., OpenAI, Gemini)
 * Handles HTTP requests and response processing for remote embedding services
 */
export class EmbedModelApiAdapter {
  adapter: string;
  model_key: string;
  dims: number;
  models: Record<string, ModelInfo>;
  settings: any;
  tiktoken: any;

  constructor(config: {
    adapter: string;
    model_key: string;
    dims: number;
    models: Record<string, ModelInfo>;
    settings: any;
  }) {
    this.adapter = config.adapter;
    this.model_key = config.model_key;
    this.dims = config.dims;
    this.models = config.models;
    this.settings = config.settings;
  }

  /**
   * Get the request adapter class
   */
  get req_adapter(): typeof EmbedModelRequestAdapter {
    return EmbedModelRequestAdapter;
  }

  /**
   * Get the response adapter class
   */
  get res_adapter(): typeof EmbedModelResponseAdapter {
    return EmbedModelResponseAdapter;
  }

  /**
   * Get API endpoint URL
   */
  get endpoint(): string | undefined {
    const model = this.models[this.model_key];
    return model?.endpoint;
  }

  /**
   * Get API key from settings
   */
  get api_key(): string | undefined {
    return this.settings[`${this.adapter}.api_key`] || this.settings.api_key;
  }

  /**
   * Get max tokens for current model
   */
  get max_tokens(): number {
    const model = this.models[this.model_key];
    return model?.max_tokens || 8191;
  }

  /**
   * Get batch size for current model
   */
  get batch_size(): number {
    const model = this.models[this.model_key];
    return model?.batch_size || 1;
  }

  /**
   * Count tokens in input text
   * @param input - Text to tokenize
   * @returns Token count
   */
  async count_tokens(input: string): Promise<number> {
    throw new Error('count_tokens not implemented');
  }

  /**
   * Estimate token count for input text
   * Uses character-based estimation (3.7 chars per token)
   * @param input - Input to estimate tokens for
   * @returns Estimated token count
   */
  estimate_tokens(input: string | object): number {
    if (typeof input === 'object') input = JSON.stringify(input);
    return Math.ceil((input as string).length / 3.7);
  }

  /**
   * Process a batch of inputs for embedding
   * @param inputs - Array of input objects
   * @returns Processed inputs with embeddings
   */
  async embed_batch(inputs: (EmbedInput | { _embed_input: string })[]): Promise<EmbedResult[]> {
    if (!this.api_key) throw new Error('API key not set');

    // Normalize inputs
    const normalized_inputs = inputs
      .map((item) => {
        const embed_input = 'embed_input' in item ? item.embed_input : item._embed_input;
        return { ...item, embed_input } as EmbedInput;
      })
      .filter((item) => (item.embed_input?.length ?? 0) > 0);

    if (normalized_inputs.length === 0) {
      console.log('Empty batch (or all items have empty embed_input)');
      return [];
    }

    // Prepare inputs while preserving source item mapping
    const prepared_items = await Promise.all(
      normalized_inputs.map(async (item) => ({
        item,
        prepared: await this.prepare_embed_input(item.embed_input!),
      })),
    );

    const valid_items = prepared_items.filter(
      (entry) => typeof entry.prepared === 'string' && entry.prepared.length > 0,
    );

    if (valid_items.length === 0) {
      console.log('All embed inputs were trimmed to empty values');
      return [];
    }

    // Create request and response adapters
    const _req = new this.req_adapter(this, valid_items.map((entry) => entry.prepared as string));
    const request_params = _req.to_platform();

    const resp = await this.request(request_params);

    const _res = new this.res_adapter(this, resp);
    const embeddings = _res.to_openai();
    if (!embeddings) {
      console.error('Failed to parse embeddings.');
      return [];
    }

    return valid_items.map((entry, i) => {
      const item = entry.item;
      return {
        ...item,
        vec: embeddings[i].vec,
        tokens: embeddings[i].tokens,
      } as EmbedResult;
    });
  }

  /**
   * Prepare input text for embedding
   * @param embed_input - Raw input text
   * @returns Processed input text
   */
  async prepare_embed_input(embed_input: string): Promise<string | null> {
    throw new Error('prepare_embed_input not implemented');
  }

  /**
   * Prepare request headers
   * @returns Headers object with authorization
   */
  prepare_request_headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.api_key}`,
    };
  }

  /**
   * Make API request. Throws typed errors for the pipeline to handle.
   * No retry at this level — the pipeline is the single retry layer.
   * @param req - Request configuration
   * @returns API response JSON
   */
  async request(req: Record<string, any>): Promise<any> {
    try {
      const resp = await requestUrl({
        url: this.endpoint!,
        method: req.method || 'POST',
        headers: req.headers,
        body: req.body,
        throw: false,
      });

      if (resp.status >= 400) {
        const message = resp.text || 'Request failed';
        if (resp.status === 429 || resp.status >= 500) {
          throw new TransientError(message, resp.status);
        }
        throw new FatalError(message, resp.status);
      }

      return resp.json;
    } catch (error: any) {
      // Re-throw typed errors
      if (error instanceof TransientError || error instanceof FatalError) {
        throw error;
      }
      // Network/unknown errors are transient
      throw new TransientError(error.message || 'Network error', 0);
    }
  }

  /**
   * Validate API key by making test request
   * @returns True if API key is valid
   */
  async test_api_key(): Promise<void> {
    const resp = await this.embed_batch([{ embed_input: 'test' }]);
    if (!Array.isArray(resp) || resp.length === 0 || !resp[0].vec) {
      throw new Error('API key validation failed');
    }
  }

  /**
   * Trim input text to satisfy max_tokens
   * @param embed_input - Input text
   * @param tokens_ct - Existing token count
   * @returns Trimmed text
   */
  async trim_input_to_max_tokens(embed_input: string, tokens_ct: number): Promise<string | null> {
    const max_tokens = this.max_tokens || 0;
    const reduce_ratio = (tokens_ct - max_tokens) / tokens_ct;
    const new_length = Math.floor(embed_input.length * (1 - reduce_ratio));
    let trimmed_input = embed_input.slice(0, new_length);
    const last_space_index = trimmed_input.lastIndexOf(' ');
    if (last_space_index > 0) trimmed_input = trimmed_input.slice(0, last_space_index);
    const prepared = await this.prepare_embed_input(trimmed_input);
    if (prepared === null) return null;
    return prepared;
  }

  /**
   * Load tiktoken tokenizer for accurate token counting
   */
  async load_tiktoken(): Promise<void> {
    // Lazy load tiktoken if needed by subclass
    const { Tiktoken } = await import('js-tiktoken/lite');
    const cl100k_base = await fetch(
      'https://raw.githubusercontent.com/brianpetro/jsbrains/refs/heads/main/smart-embed-model/cl100k_base.json',
    ).then((r) => r.json());
    this.tiktoken = new Tiktoken(cl100k_base);
  }

  /**
   * Get model information
   * @param model_key - Optional model key override
   * @returns Model information
   */
  get_model_info(model_key?: string): ModelInfo | undefined {
    return this.models[model_key || this.model_key];
  }
}

/**
 * Base class for request adapters to handle various input schemas and convert them to platform-specific schema
 */
export class EmbedModelRequestAdapter {
  adapter: EmbedModelApiAdapter;
  embed_inputs: string[];

  constructor(adapter: EmbedModelApiAdapter, embed_inputs: string[]) {
    this.adapter = adapter;
    this.embed_inputs = embed_inputs;
  }

  get model_id(): string {
    return this.adapter.model_key;
  }

  get model_dims(): number | undefined {
    return this.adapter.dims;
  }

  /**
   * Get request headers
   * @returns Headers object
   */
  get_headers(): Record<string, string> {
    return this.adapter.prepare_request_headers();
  }

  /**
   * Convert request to platform-specific format
   * @returns Platform-specific request parameters
   */
  to_platform(): Record<string, any> {
    return {
      method: 'POST',
      headers: this.get_headers(),
      body: JSON.stringify(this.prepare_request_body()),
    };
  }

  /**
   * Prepare request body for API call
   * @returns Request body object
   */
  prepare_request_body(): Record<string, any> {
    throw new Error('prepare_request_body not implemented');
  }
}

/**
 * Base class for response adapters to handle various output schemas and convert them to standard schema
 */
export class EmbedModelResponseAdapter {
  adapter: EmbedModelApiAdapter;
  response: any;

  constructor(adapter: EmbedModelApiAdapter, response: any) {
    this.adapter = adapter;
    this.response = response;
  }

  /**
   * Convert response to standard format
   * @returns Array of embedding results
   */
  to_openai(): EmbedResult[] {
    return this.parse_response();
  }

  /**
   * Parse API response
   * @returns Parsed embedding results
   */
  parse_response(): EmbedResult[] {
    throw new Error('parse_response not implemented');
  }
}
