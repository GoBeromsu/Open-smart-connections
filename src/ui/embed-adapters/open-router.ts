/**
 * @file open-router.ts
 * @description Adapter for OpenRouter's embedding API
 */

import { requestUrl } from 'obsidian';
import {
  EmbedModelApiAdapter,
  EmbedModelRequestAdapter,
  EmbedModelResponseAdapter,
} from './api-base';
import type { AdapterConfig, EmbedResult, ModelInfo } from '../../types/models';
import { embedAdapterRegistry } from '../../domain/embed-model';
import {
  build_open_router_fallback_model,
  OPEN_ROUTER_SIGNUP_URL,
  parse_open_router_model_data,
} from './open-router-models';

/**
 * Adapter for OpenRouter's embedding API
 * Uses OpenRouter's OpenAI-compatible /v1/embeddings endpoint
 */
export class OpenRouterEmbedAdapter extends EmbedModelApiAdapter {
  static readonly MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';

  constructor(config: AdapterConfig) {
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
      return build_open_router_fallback_model(this.max_tokens);
    }

    try {
      const resp = await requestUrl({
        url: this.models_endpoint,
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.api_key}`,
        },
      });

      const parsed = parse_open_router_model_data(
        resp.json as unknown[] | Record<string, unknown>,
        this.max_tokens,
      );
      this.models = parsed;
      return parsed;
    } catch {
      return build_open_router_fallback_model(this.max_tokens);
    }
  }
}

/**
 * Request adapter for OpenRouter embedding API
 */
class OpenRouterEmbedRequestAdapter extends EmbedModelRequestAdapter {
  /**
   * Prepare request body for OpenRouter API
   */
  prepare_request_body(): Record<string, unknown> {
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
    const resp = this.response as Record<string, unknown> | null;
    const data = resp?.data as { embedding?: number[]; data?: number[] }[] | undefined;
    if (!resp || !Array.isArray(data)) {
      return [];
    }

    let avg_tokens: number = 0;
    const usage = resp.usage as { total_tokens?: number } | undefined;
    if (usage?.total_tokens && data.length > 0) {
      avg_tokens = usage.total_tokens / data.length;
    }

    return data.map((item) => {
      const vec = item.embedding || item.data || [];
      return {
        vec,
        tokens: avg_tokens,
      };
    });
  }
}

// Self-register
embedAdapterRegistry.register({
  name: 'open_router',
  displayName: 'OpenRouter',
  AdapterClass: OpenRouterEmbedAdapter,
  models: {},
  defaultDims: 1536,
  requiresApiKey: true,
  requiresHost: false,
  signupUrl: OPEN_ROUTER_SIGNUP_URL,
  dynamicModels: true,
});
