/**
 * @file ollama.ts
 * @description Adapter for Ollama's local embedding API
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
  filter_embedding_models,
  OLLAMA_SIGNUP_URL,
  type OllamaModel,
  parse_ollama_model_data,
} from './ollama-models';

/**
 * Adapter for Ollama's local embedding API
 * Handles communication with locally running Ollama instance for generating embeddings
 */
export class OllamaEmbedAdapter extends EmbedModelApiAdapter {
  host: string;
  model_data: Record<string, ModelInfo> | null = null;

  constructor(config: AdapterConfig) {
    super(config);
    this.host = config.host || 'http://localhost:11434';
  }

  get endpoint(): string {
    return `${this.host}/api/embed`;
  }

  get models_endpoint(): string {
    return `${this.host}/api/tags`;
  }

  get model_show_endpoint(): string {
    return `${this.host}/api/show`;
  }

  /**
   * Load adapter and fetch available models
   */
  async load(): Promise<void> {
    await this.get_models();
  }

  /**
   * Prepare input text and ensure it fits within max_tokens
   * @param embed_input - Raw input text
   * @returns Processed input text
   */
  async prepare_embed_input(embed_input: string): Promise<string | null> {
    if (typeof embed_input !== 'string') throw new TypeError('embed_input must be a string');
    if (embed_input.length === 0) return null;

    const tokens = await this.count_tokens(embed_input);
    if (tokens <= this.max_tokens) return embed_input;

    return await this.trim_input_to_max_tokens(embed_input, tokens);
  }

  /**
   * Get the request adapter class
   */
  get req_adapter(): typeof OllamaEmbedRequestAdapter {
    return OllamaEmbedRequestAdapter;
  }

  /**
   * Get the response adapter class
   */
  get res_adapter(): typeof OllamaEmbedResponseAdapter {
    return OllamaEmbedResponseAdapter;
  }

  /**
   * Get available models from local Ollama instance
   * @param refresh - Whether to refresh cached models
   * @returns Map of model objects
   */
  async get_models(refresh: boolean = false): Promise<Record<string, ModelInfo>> {
    if (!this.model_data || refresh) {
      const list_resp = await requestUrl({
        url: this.models_endpoint,
        method: 'GET',
      });

      if (list_resp.status >= 400) {
        throw new Error(`Failed to fetch models list: ${list_resp.status}`);
      }

      const list_data = list_resp.json as { models?: OllamaModel[] };
      const models_raw: Record<string, unknown>[] = [];

      for (const m of filter_embedding_models(list_data.models ?? [])) {
        const detail_resp = await requestUrl({
          url: this.model_show_endpoint,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m.name }),
        });
        models_raw.push({ ...(detail_resp.json as Record<string, unknown>), name: m.name });
      }

      this.model_data = parse_ollama_model_data(models_raw, this.max_tokens);
      this.models = this.model_data;
    }

    return this.model_data;
  }
}

/**
 * Request adapter for Ollama embedding API
 */
class OllamaEmbedRequestAdapter extends EmbedModelRequestAdapter {
  /**
   * Convert request to Ollama's embed API format
   */
  to_platform(): Record<string, unknown> {
    return {
      url: (this.adapter as OllamaEmbedAdapter).endpoint,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model_id,
        input: this.embed_inputs,
      }),
    };
  }
}

/**
 * Response adapter for Ollama embedding API
 */
class OllamaEmbedResponseAdapter extends EmbedModelResponseAdapter {
  /**
   * Convert Ollama's response to standardized format
   */
  parse_response(): EmbedResult[] {
    const resp = this.response as Record<string, unknown> | null;
    const embeddings = resp?.embeddings as number[][] | undefined;

    if (!resp || !embeddings) {
      return [];
    }

    const tokens = Math.ceil((resp.prompt_eval_count as number) / this.adapter.batch_size);
    return embeddings.map((vec) => ({
      vec,
      tokens,
    }));
  }
}

// Self-register
embedAdapterRegistry.register({
  name: 'ollama',
  displayName: 'Ollama (Local)',
  AdapterClass: OllamaEmbedAdapter,
  models: {},
  defaultDims: 384,
  requiresApiKey: false,
  requiresHost: true,
  defaultHost: 'http://localhost:11434',
  signupUrl: OLLAMA_SIGNUP_URL,
  dynamicModels: true,
});
