/**
 * @file open_router.ts
 * @description Adapter for OpenRouter's embedding API
 */

import { requestUrl } from 'obsidian';
import {
  EmbedModelApiAdapter,
  EmbedModelRequestAdapter,
  EmbedModelResponseAdapter,
} from './_api';
import type { EmbedResult, ModelInfo } from '../../../types/models';

/**
 * Adapter for OpenRouter's embedding API
 * Uses OpenRouter's OpenAI-compatible /v1/embeddings endpoint
 */
export class OpenRouterEmbedAdapter extends EmbedModelApiAdapter {
  static readonly MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';

  constructor(config: any) {
    super(config);
  }

  get endpoint(): string {
    return 'https://openrouter.ai/api/v1/embeddings';
  }

  get models_endpoint(): string {
    return OpenRouterEmbedAdapter.MODELS_ENDPOINT;
  }

  /**
   * Get the request adapter class
   */
  get req_adapter(): typeof OpenRouterEmbedRequestAdapter {
    return OpenRouterEmbedRequestAdapter;
  }

  /**
   * Get the response adapter class
   */
  get res_adapter(): typeof OpenRouterEmbedResponseAdapter {
    return OpenRouterEmbedResponseAdapter;
  }

  /**
   * Estimate token count for input text
   * OpenRouter does not expose a tokenizer, so we use a character-based heuristic
   * @param input - Text to tokenize
   * @returns Token count
   */
  async count_tokens(input: string): Promise<number> {
    return this.estimate_tokens(input);
  }

  /**
   * Prepare input text and ensure it fits within max_tokens
   * @param embed_input - Raw input text
   * @returns Processed input text
   */
  async prepare_embed_input(embed_input: string): Promise<string | null> {
    if (typeof embed_input !== 'string') {
      throw new TypeError('embed_input must be a string');
    }
    if (embed_input.length === 0) return null;

    const tokens = await this.count_tokens(embed_input);
    if (tokens <= this.max_tokens) return embed_input;

    return await this.trim_input_to_max_tokens(embed_input, tokens);
  }

  /**
   * Fetch available models from OpenRouter and filter to embedding models
   * @param refresh - Force refresh of model list
   * @returns Map of model objects keyed by model id
   */
  async get_models(refresh: boolean = false): Promise<Record<string, ModelInfo>> {
    if (!refresh && this.models && Object.keys(this.models).length > 0) {
      return this.models;
    }

    if (!this.api_key) {
      console.warn('[OpenRouterEmbedAdapter] API key missing; cannot fetch models from OpenRouter.');
      const fallback_id = 'text-embedding-3-small';
      return {
        [fallback_id]: {
          model_key: fallback_id,
          model_name: fallback_id,
          description: 'OpenRouter embedding model',
          max_tokens: this.max_tokens,
        },
      };
    }

    try {
      const resp = await requestUrl({
        url: this.models_endpoint,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.api_key}`,
        },
      });

      const parsed = this.parse_model_data(resp.json);
      this.models = parsed;
      return parsed;
    } catch (error) {
      console.error('[OpenRouterEmbedAdapter] Failed to fetch models:', error);
      const fallback_id = 'text-embedding-3-small';
      return {
        [fallback_id]: {
          model_key: fallback_id,
          model_name: fallback_id,
          description: 'OpenRouter embedding model',
          max_tokens: this.max_tokens,
        },
      };
    }
  }

  /**
   * Parse OpenRouter /v1/models response into standard format
   * Only keeps models that look like embeddings
   * @param model_data - Raw models payload from OpenRouter
   * @returns Map of model objects keyed by id
   */
  parse_model_data(model_data: any): Record<string, ModelInfo> {
    let list: any[] = [];
    if (Array.isArray(model_data?.data)) list = model_data.data;
    else if (Array.isArray(model_data)) list = model_data;
    else {
      console.error('[OpenRouterEmbedAdapter] Invalid model data format from OpenRouter:', model_data);
      return { _: { model_key: 'No models found.' } };
    }

    const out: Record<string, ModelInfo> = {};
    for (const model of list) {
      const model_id = model.id || model.name;
      if (!model_id) continue;
      if (!is_embedding_model(model_id)) continue;

      out[model_id] = {
        model_key: model_id,
        model_name: model_id,
        max_tokens: model.context_length || this.max_tokens,
        description: model.name || model.description || `Model: ${model_id}`,
      };
    }

    if (!Object.keys(out).length) {
      return { _: { model_key: 'No embedding models found.' } };
    }

    return out;
  }
}

/**
 * Request adapter for OpenRouter embedding API
 */
class OpenRouterEmbedRequestAdapter extends EmbedModelRequestAdapter {
  /**
   * Prepare request body for OpenRouter API
   */
  prepare_request_body(): Record<string, any> {
    return {
      model: this.model_id,
      input: this.embed_inputs,
    };
  }
}

/**
 * Response adapter for OpenRouter embedding API
 */
class OpenRouterEmbedResponseAdapter extends EmbedModelResponseAdapter {
  /**
   * Parse OpenRouter embedding response
   */
  parse_response(): EmbedResult[] {
    const resp = this.response;
    if (!resp || !Array.isArray(resp.data)) {
      console.error('[OpenRouterEmbedResponseAdapter] Invalid embedding response format:', resp);
      return [];
    }

    let avg_tokens: number = 0;
    if (resp.usage?.total_tokens && resp.data.length > 0) {
      avg_tokens = resp.usage.total_tokens / resp.data.length;
    }

    return resp.data.map((item: any) => {
      const vec = item.embedding || item.data || [];
      return {
        vec,
        tokens: avg_tokens,
      };
    });
  }
}

/**
 * Heuristic filter: true when an id looks like an embedding model
 * @param id - Model identifier
 * @returns True if model appears to be an embedding model
 */
function is_embedding_model(id: string): boolean {
  const lower = String(id || '').toLowerCase();
  const segments = lower.split(/[-:/_]/);
  if (segments.some((seg) => ['embed', 'embedding', 'bge'].includes(seg))) return true;
  if (lower.includes('text-embedding')) return true;
  return false;
}
