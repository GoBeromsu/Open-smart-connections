/**
 * @file ollama.ts
 * @description Adapter for Ollama's local embedding API
 */

import { requestUrl } from 'obsidian';
import {
  EmbedModelApiAdapter,
  EmbedModelRequestAdapter,
  EmbedModelResponseAdapter,
} from './_api';
import type { EmbedResult, ModelInfo } from '../../../types/models';

interface OllamaModel {
  name: string;
  [key: string]: any;
}

/**
 * Adapter for Ollama's local embedding API
 * Handles communication with locally running Ollama instance for generating embeddings
 */
export class OllamaEmbedAdapter extends EmbedModelApiAdapter {
  host: string;
  model_data: Record<string, ModelInfo> | null = null;

  constructor(config: any) {
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
   * Estimate token count for input text
   * Ollama does not expose a tokenizer so we use a character based heuristic
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

      const list_data = list_resp.json;
      const models_raw: any[] = [];

      for (const m of filter_embedding_models(list_data.models || [])) {
        const detail_resp = await requestUrl({
          url: this.model_show_endpoint,
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m.name }),
        });
        models_raw.push({ ...detail_resp.json, name: m.name });
      }

      this.model_data = this.parse_model_data(models_raw);
      this.models = this.model_data;
    }

    return this.model_data;
  }

  /**
   * Parse model data from Ollama API response
   * @param model_data - Raw model data from Ollama
   * @returns Map of model objects with capabilities and limits
   */
  parse_model_data(model_data: any[]): Record<string, ModelInfo> {
    if (!Array.isArray(model_data)) {
      console.error('Invalid model data format from Ollama:', model_data);
      return {};
    }

    if (model_data.length === 0) {
      return {
        no_models_available: {
          model_key: 'no_models_available',
          model_name: 'No models currently available',
        },
      };
    }

    return model_data.reduce((acc: Record<string, ModelInfo>, model) => {
      const info = model.model_info || {};
      const ctx = Object.entries(info).find(([k]) => k.includes('context_length'))?.[1] as
        | number
        | undefined;
      const dims = Object.entries(info).find(([k]) => k.includes('embedding_length'))?.[1] as
        | number
        | undefined;

      acc[model.name] = {
        model_key: model.name,
        model_name: model.name,
        max_tokens: ctx || this.max_tokens,
        dims,
        description: model.description || `Model: ${model.name}`,
      };
      return acc;
    }, {});
  }
}

/**
 * Request adapter for Ollama embedding API
 */
class OllamaEmbedRequestAdapter extends EmbedModelRequestAdapter {
  /**
   * Convert request to Ollama's embed API format
   */
  to_platform(): Record<string, any> {
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
    const resp = this.response;

    if (!resp || !resp.embeddings) {
      console.error('Invalid response format from Ollama:', resp);
      return [];
    }

    const tokens = Math.ceil(resp.prompt_eval_count / this.adapter.batch_size);
    return resp.embeddings.map((vec: number[]) => ({
      vec,
      tokens,
    }));
  }
}

/**
 * Filter to extract embedding models from Ollama model list
 * @param models - Array of models from Ollama
 * @returns Filtered array of embedding models
 */
export function filter_embedding_models(models: OllamaModel[]): OllamaModel[] {
  if (!Array.isArray(models)) {
    throw new TypeError('models must be an array');
  }
  return models.filter((mod) =>
    ['embed', 'embedding', 'bge'].some((keyword) => mod.name.toLowerCase().includes(keyword)),
  );
}
