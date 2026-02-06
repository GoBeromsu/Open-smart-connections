import { SmartEmbedAdapter } from "./_adapter";
import { SmartHttpRequest } from "smart-http-request";
import { SmartHttpRequestFetchAdapter } from "smart-http-request/adapters/fetch.js";
import { Tiktoken } from "js-tiktoken/lite";
import { fetch_json_cached } from '../utils/fetch_cache';
import { normalize_error } from 'smart-utils/normalize_error.js';
import type { AdapterDefaults, EmbedInput, EmbedResult, SettingsConfigEntry } from '../../types';

const CL100K_URL = 'https://raw.githubusercontent.com/brianpetro/jsbrains/refs/heads/main/smart-embed-model/cl100k_base.json';

/**
 * Base adapter class for API-based embedding models (e.g., OpenAI)
 * Handles HTTP requests and response processing for remote embedding services
 * @extends SmartEmbedAdapter
 */
export class SmartEmbedModelApiAdapter extends SmartEmbedAdapter {
  _http_adapter: any;
  tiktoken: any;

  /**
   * Get the request adapter class.
   * @returns {typeof SmartEmbedModelRequestAdapter} The request adapter class
   */
  get req_adapter(): typeof SmartEmbedModelRequestAdapter {
    return SmartEmbedModelRequestAdapter;
  }

  /**
   * Get the response adapter class.
   * @returns {typeof SmartEmbedModelResponseAdapter} The response adapter class
   */
  get res_adapter(): typeof SmartEmbedModelResponseAdapter {
    return SmartEmbedModelResponseAdapter;
  }

  /** @returns {string} API endpoint URL */
  get endpoint(): string | undefined {
    return this.model.data.endpoint;
  }

  /**
   * Get HTTP request adapter instance
   * @returns {any} HTTP request handler
   */
  get http_adapter(): any {
    if (!this._http_adapter) {
      if (this.model.opts.http_adapter)
        this._http_adapter = this.model.opts.http_adapter;
      else
        this._http_adapter = new SmartHttpRequest({
          adapter: SmartHttpRequestFetchAdapter,
        });
    }
    return this._http_adapter;
  }

  /**
   * Count tokens in input text
   * @abstract
   * @param {string} input - Text to tokenize
   * @returns {Promise<{tokens: number}>} Token count result
   * @throws {Error} If not implemented by subclass
   */
  async count_tokens(input: string): Promise<{ tokens: number }> {
    throw new Error("count_tokens not implemented");
  }

  /**
   * Estimate token count for input text
   * Uses character-based estimation (3.7 chars per token)
   * @param {string|object} input - Input to estimate tokens for
   * @returns {number} Estimated token count
   */
  estimate_tokens(input: string | object): number {
    if (typeof input === "object") input = JSON.stringify(input);
    return Math.ceil((input as string).length / 3.7);
  }

  /**
   * Process a batch of inputs for embedding
   * @param {EmbedInput[]} inputs - Array of input objects
   * @returns {Promise<EmbedInput[]>} Processed inputs with embeddings
   * @throws {Error} If API key is not set
   */
  async embed_batch(inputs: EmbedInput[]): Promise<EmbedInput[]> {
    if (!this.api_key) throw new Error("API key not set");
    const normalized_inputs = inputs.filter((item) => (item.embed_input?.length ?? 0) > 0);
    if (normalized_inputs.length === 0) {
      console.log("Empty batch (or all items have empty embed_input)");
      return [];
    }

    // Prepare inputs while preserving source item mapping.
    const prepared_items = await Promise.all(
      normalized_inputs.map(async (item) => ({
        item,
        prepared: await this.prepare_embed_input(item.embed_input!),
      }))
    );
    const valid_items = prepared_items.filter((entry) => typeof entry.prepared === "string" && entry.prepared.length > 0);
    if (valid_items.length === 0) {
      console.log("All embed inputs were trimmed to empty values");
      return [];
    }

    // Create request and response adapters
    const _req = new this.req_adapter(this, valid_items.map((entry) => entry.prepared as string));
    const request_params = _req.to_platform();

    const resp = await this.request(request_params);
    if (!resp) {
      console.error("No response received for embedding request.");
      return [];
    }
    if(resp.error) return [resp];

    const _res = new this.res_adapter(this, resp);
    const embeddings = _res.to_openai();
    if (!embeddings) {
      console.error("Failed to parse embeddings.");
      return [];
    }

    return valid_items.map((entry, i) => {
      const item = entry.item;
      item.vec = embeddings[i].vec;
      item.tokens = embeddings[i].tokens;
      return item;
    });
  }

  /**
   * Prepare input text for embedding
   * @abstract
   * @param {string} embed_input - Raw input text
   * @returns {Promise<string|null>} Processed input text
   * @throws {Error} If not implemented by subclass
   */
  async prepare_embed_input(embed_input: string): Promise<string | null> {
    throw new Error("prepare_embed_input not implemented");
  }

  /**
   * Prepare request headers
   * @returns {Record<string, string>} Headers object with authorization
   */
  prepare_request_headers(): Record<string, string> {
    return this.build_auth_headers({
      headers: {
        "Content-Type": "application/json",
        ...((this.constructor as typeof SmartEmbedModelApiAdapter).defaults?.headers || {}),
      },
      api_key_header: (this.constructor as typeof SmartEmbedModelApiAdapter).defaults?.api_key_header,
      warn_missing_api_key: true,
    });
  }

  /**
   * Make API request with retry logic
   * @param {Record<string, any>} req - Request configuration
   * @param {number} [retries=0] - Number of retries attempted
   * @returns {Promise<any>} API response
   */
  async request(req: Record<string, any>, retries: number = 0): Promise<any> {
    try {
      req.throw = false;
      const resp = await this.http_adapter.request({
        url: this.endpoint,
        ...req,
      });
      const resp_json = await this.get_resp_json(resp);
      if(resp_json.error) {
        return {error: normalize_error(resp_json, resp.status())};
      }
      return resp_json;
    } catch (error: any) {
      console.warn("Request error:", error);
      return await this.handle_request_err(error, req, retries);
    }
  }

  /**
   * Handle API request errors with retry logic
   * @param {any} error - Error object
   * @param {Record<string, any>} req - Original request
   * @param {number} retries - Number of retries attempted
   * @returns {Promise<any>} Retry response or null
   */
  async handle_request_err(error: any, req: Record<string, any>, retries: number): Promise<any> {
    if (error.status === 429 && retries < 3) {
      const backoff = Math.pow(retries + 1, 2);
      console.log(`Retrying request (429) in ${backoff} seconds...`);
      await new Promise((r) => setTimeout(r, 1000 * backoff));
      return await this.request(req, retries + 1);
    }
    console.error(error);
    return null;
  }

  /**
   * Parse response body as JSON
   * @param {any} resp - Response object
   * @returns {Promise<any>} Parsed JSON
   */
  async get_resp_json(resp: any): Promise<any> {
    return typeof resp.json === "function" ? await resp.json() : await resp.json;
  }

  /**
   * Validate API key by making test request
   * @returns {Promise<boolean>} True if API key is valid
   */
  async validate_api_key(): Promise<boolean> {
    const resp = await this.embed_batch([{ embed_input: "test" }]);
    return Array.isArray(resp) && resp.length > 0 && resp[0].vec !== null;
  }
  /**
   * Trim input text to satisfy `max_tokens`.
   * @param {string} embed_input - Input text
   * @param {number} tokens_ct - Existing token count
   * @returns {Promise<string|null>} Trimmed text
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

  async load_tiktoken(): Promise<void> {
    const cl100k_base = await fetch_json_cached(CL100K_URL, 'cl100k_base.json');
    this.tiktoken = new Tiktoken(cl100k_base);
  }
}

/**
 * Base class for request adapters to handle various input schemas and convert them to platform-specific schema.
 * @class SmartEmbedModelRequestAdapter
 */
export class SmartEmbedModelRequestAdapter {
  adapter: SmartEmbedModelApiAdapter;
  embed_inputs: string[];

  /**
   * @constructor
   * @param {SmartEmbedModelApiAdapter} adapter - The SmartEmbedModelApiAdapter instance
   * @param {string[]} embed_inputs - The array of input texts
   */
  constructor(adapter: SmartEmbedModelApiAdapter, embed_inputs: string[]) {
    this.adapter = adapter;
    this.embed_inputs = embed_inputs;
  }

  get model_id(): string {
    return this.adapter.model?.data?.model_key
      || this.adapter.model?.model_key
      || (this.adapter.constructor as typeof SmartEmbedModelApiAdapter)?.defaults?.default_model
      || '';
  }
  get model_dims(): number | undefined {
    return this.adapter.model?.data?.dims;
  }

  /**
   * Get request headers
   * @returns {Record<string, string>} Headers object
   */
  get_headers(): Record<string, string> {
    return this.adapter.prepare_request_headers();
  }

  /**
   * Convert request to platform-specific format
   * @returns {Record<string, any>} Platform-specific request parameters
   */
  to_platform(): Record<string, any> {
    return {
      method: "POST",
      headers: this.get_headers(),
      body: JSON.stringify(this.prepare_request_body()),
    };
  }

  /**
   * Prepare request body for API call
   * @abstract
   * @returns {Record<string, any>} Request body object
   * @throws {Error} If not implemented by subclass
   */
  prepare_request_body(): Record<string, any> {
    throw new Error("prepare_request_body not implemented");
  }
}

/**
 * Base class for response adapters to handle various output schemas and convert them to standard schema.
 * @class SmartEmbedModelResponseAdapter
 */
export class SmartEmbedModelResponseAdapter {
  adapter: SmartEmbedModelApiAdapter;
  response: any;

  /**
   * @constructor
   * @param {SmartEmbedModelApiAdapter} adapter - The SmartEmbedModelApiAdapter instance
   * @param {any} response - The response object
   */
  constructor(adapter: SmartEmbedModelApiAdapter, response: any) {
    this.adapter = adapter;
    this.response = response;
  }

  /**
   * Convert response to standard format
   * @returns {EmbedResult[]} Array of embedding results
   */
  to_openai(): EmbedResult[] {
    return this.parse_response();
  }

  /**
   * Parse API response
   * @abstract
   * @returns {EmbedResult[]} Parsed embedding results
   * @throws {Error} If not implemented by subclass
   */
  parse_response(): EmbedResult[] {
    throw new Error("parse_response not implemented");
  }
}
