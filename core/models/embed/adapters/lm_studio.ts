/**
 * @file lm_studio.ts
 * @description Adapter for LM Studio's local embedding API
 */

import { requestUrl } from 'obsidian';
import {
  EmbedModelApiAdapter,
  EmbedModelRequestAdapter,
  EmbedModelResponseAdapter,
} from './_api';
import type { EmbedInput, EmbedResult, ModelInfo } from '../../../types/models';

/**
 * Parse LM Studio models from API response
 * @param list - Response from LM Studio /v1/models endpoint
 * @returns Parsed models map
 */
export function parse_lm_studio_models(list: any): Record<string, ModelInfo> {
  if (list.object !== 'list' || !Array.isArray(list.data)) {
    return { _: { model_key: 'No models found.' } };
  }

  return list.data
    .filter((m: any) => m.id && m.type === 'embeddings')
    .reduce((acc: Record<string, ModelInfo>, m: any) => {
      acc[m.id] = {
        model_key: m.id,
        model_name: m.id,
        max_tokens: m.loaded_context_length || 512,
        description: `LM Studio model: ${m.id}`,
      };
      return acc;
    }, {});
}

/**
 * Adapter for LM Studio's local embedding API
 */
export class LmStudioEmbedAdapter extends EmbedModelApiAdapter {
  host: string;

  constructor(config: any) {
    super(config);
    this.host = config.host || 'http://localhost:1234';
  }

  get endpoint(): string {
    return `${this.host}/api/v0/embeddings`;
  }

  get models_endpoint(): string {
    return `${this.host}/api/v0/models`;
  }

  /**
   * Get the request adapter class
   */
  get req_adapter(): typeof LmStudioEmbedRequestAdapter {
    return LmStudioEmbedRequestAdapter;
  }

  /**
   * Get the response adapter class
   */
  get res_adapter(): typeof LmStudioEmbedResponseAdapter {
    return LmStudioEmbedResponseAdapter;
  }

  /**
   * Count tokens in input text using estimation
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
   * Get available models from LM Studio
   * @param refresh - Whether to refresh cached models
   * @returns Map of model objects
   */
  async get_models(refresh: boolean = false): Promise<Record<string, ModelInfo>> {
    if (!refresh && this.models && Object.keys(this.models).length > 0) {
      return this.models;
    }

    const resp = await requestUrl({
      url: this.models_endpoint,
      method: 'GET',
    });

    const parsed = parse_lm_studio_models(resp.json);
    this.models = parsed;
    return parsed;
  }

  /**
   * Embed batch with token estimation
   * @param inputs - Array of input objects
   * @returns Processed inputs with embeddings
   */
  async embed_batch(inputs: (EmbedInput | { _embed_input: string })[]): Promise<EmbedResult[]> {
    const token_cts = inputs.map((item) => {
      const embed_input = 'embed_input' in item ? item.embed_input : item._embed_input;
      return this.estimate_tokens(embed_input || '');
    });

    const resp = await super.embed_batch(inputs);
    resp.forEach((item, idx) => {
      item.tokens = token_cts[idx];
    });

    return resp;
  }
}

/**
 * Request adapter for LM Studio embedding API
 */
class LmStudioEmbedRequestAdapter extends EmbedModelRequestAdapter {
  /**
   * Prepare request body for LM Studio API
   */
  prepare_request_body(): Record<string, any> {
    return {
      model: this.model_id,
      input: this.embed_inputs,
    };
  }
}

/**
 * Response adapter for LM Studio embedding API
 */
class LmStudioEmbedResponseAdapter extends EmbedModelResponseAdapter {
  /**
   * Parse LM Studio API response
   */
  parse_response(): EmbedResult[] {
    const resp = this.response;
    if (!resp || !resp.data) {
      console.error('Invalid response format', resp);
      return [];
    }

    return resp.data.map((item: any) => ({
      vec: item.embedding,
      tokens: 0, // LM Studio doesn't provide token usage
    }));
  }
}
