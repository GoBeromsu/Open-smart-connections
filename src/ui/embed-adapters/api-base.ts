/**
 * @file api-base.ts
 * @description Base adapter classes for API-based embedding models
 */

import { requestUrl } from 'obsidian';
import type { EmbedInput, EmbedResult, ModelInfo } from '../../types/models';
import { TransientError, FatalError } from '../../domain/config';

/**
 * Base adapter class for API-based embedding models (e.g., OpenAI, Gemini)
 * Handles HTTP requests and response processing for remote embedding services
 */
export class EmbedModelApiAdapter {
  adapter: string;
  model_key: string;
  dims: number;
  models: Record<string, ModelInfo>;
  settings: Record<string, unknown>;
  tiktoken: { encode(text: string): number[] } | null = null;

  constructor(config: {
    adapter: string;
    model_key: string;
    dims: number;
    models: Record<string, ModelInfo>;
    settings: Record<string, unknown>;
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
    return (this.settings[`${this.adapter}.api_key`] as string | undefined) || (this.settings.api_key as string | undefined);
  }

  /**
   * Get max tokens for current model
   */
  get max_tokens(): number {
    const model = this.models[this.model_key];
    return model?.max_tokens || 8191;
  }

  /**
   * Per-request token budget. Adapters can override this to leave safety
   * headroom below the provider hard limit.
   */
  get request_token_budget(): number {
    return this.max_tokens;
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
  count_tokens(input: string): Promise<number> {
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
    return Math.ceil(input.length / 3.7);
  }

  /**
   * Process a batch of inputs for embedding
   * @param inputs - Array of input objects
   * @returns Processed inputs with embeddings
   */
  async embed_batch(inputs: (EmbedInput | { _embed_input: string })[]): Promise<EmbedResult[]> {
    if (!this.api_key) throw new Error('API key not set');

    // Normalize ALL inputs — preserve 1:1 mapping with input array.
    // Items that fail preparation get { vec: [], tokens: 0 } instead of being dropped,
    // which prevents BatchIntegrityError in the pipeline.
    const normalized: { item: EmbedInput; originalIndex: number }[] = [];
    for (let i = 0; i < inputs.length; i++) {
      const raw = inputs[i];
      const embed_input = 'embed_input' in raw ? raw.embed_input : raw._embed_input;
      normalized.push({ item: { ...raw, embed_input } as EmbedInput, originalIndex: i });
    }

    // Prepare inputs — track which succeeded
    const prepared = await Promise.all(
      normalized.map(async (entry) => {
        if (!entry.item.embed_input || entry.item.embed_input.length === 0) return { ...entry, prepared: null };
        const prepared = await this.prepare_embed_input(entry.item.embed_input);
        if (typeof prepared !== 'string' || prepared.length === 0) {
          return { ...entry, prepared: null, token_count: 0 };
        }
        const token_count = await this.count_tokens(prepared);
        return { ...entry, prepared, token_count };
      }),
    );

    const valid = prepared.filter((e): e is typeof e & { prepared: string } => e.prepared !== null);

    // Build result array preserving original positions
    const results: EmbedResult[] = normalized.map((entry) => ({
      ...entry.item,
      vec: [],
      tokens: 0,
    } as EmbedResult));

    if (valid.length === 0) {
      return results;
    }

    const budget = Math.max(1, this.request_token_budget || this.max_tokens || 1);
    const request_batches: typeof valid[] = [];
    let current_batch: typeof valid = [];
    let current_tokens = 0;

    for (const entry of valid) {
      const token_count = Math.max(1, entry.token_count || 0);
      if (current_batch.length > 0 && current_tokens + token_count > budget) {
        request_batches.push(current_batch);
        current_batch = [];
        current_tokens = 0;
      }
      current_batch.push(entry);
      current_tokens += token_count;
    }
    if (current_batch.length > 0) {
      request_batches.push(current_batch);
    }

    for (const batch of request_batches) {
      const _req = new this.req_adapter(this, batch.map((entry) => entry.prepared));
      const request_params = _req.to_platform();
      const resp = await this.request(request_params);
      const _res = new this.res_adapter(this, resp);
      const embeddings = _res.to_openai();
      if (!embeddings) {
        continue;
      }

      // Map API results back to original positions while preserving the caller's order.
      for (let i = 0; i < batch.length && i < embeddings.length; i++) {
        const idx = batch[i].originalIndex;
        results[idx].vec = embeddings[i].vec;
        results[idx].tokens = embeddings[i].tokens;
      }
    }

    return results;
  }

  /**
   * Prepare input text for embedding
   * @param embed_input - Raw input text
   * @returns Processed input text
   */
  prepare_embed_input(embed_input: string): Promise<string | null> {
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
  async request(req: Record<string, unknown>): Promise<unknown> {
    try {
      const resp = await requestUrl({
        url: this.endpoint!,
        method: (req.method as string) || 'POST',
        headers: req.headers as Record<string, string>,
        body: req.body as string,
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
    } catch (error: unknown) {
      // Re-throw typed errors
      if (error instanceof TransientError || error instanceof FatalError) {
        throw error;
      }
      // Network/unknown errors are transient
      const msg = error instanceof Error ? error.message : 'Network error';
      throw new TransientError(msg, 0);
    }
  }

  /**
   * Embed a search query. Subclasses can override to use a query-specific model
   * (e.g., Upstage uses embedding-query vs embedding-passage).
   * Defaults to embed_batch.
   */
  embed_query(query: string): Promise<EmbedResult[]> {
    return this.embed_batch([{ embed_input: query }]);
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
  async trim_input_to_max_tokens(
    embed_input: string,
    tokens_ct: number,
    max_tokens_override?: number,
  ): Promise<string | null> {
    const max_tokens = max_tokens_override || this.max_tokens || 0;
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
    const resp = await requestUrl('https://raw.githubusercontent.com/brianpetro/jsbrains/refs/heads/main/smart-embed-model/cl100k_base.json');
    this.tiktoken = new Tiktoken(resp.json);
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
  to_platform(): Record<string, unknown> {
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
  prepare_request_body(): Record<string, unknown> {
    throw new Error('prepare_request_body not implemented');
  }
}

/**
 * Base class for response adapters to handle various output schemas and convert them to standard schema
 */
export class EmbedModelResponseAdapter {
  adapter: EmbedModelApiAdapter;
  response: unknown;

  constructor(adapter: EmbedModelApiAdapter, response: unknown) {
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
