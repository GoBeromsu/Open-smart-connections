/**
 * @file upstage.ts
 * @description Adapter for Upstage's embedding API
 */

import {
  EmbedModelApiAdapter,
  EmbedModelRequestAdapter,
  EmbedModelResponseAdapter,
} from './_api';
import type { EmbedResult, ModelInfo } from '../../../types/models';

/**
 * Upstage embedding models configuration
 */
export const UPSTAGE_EMBED_MODELS: Record<string, ModelInfo> = {
  'embedding-query': {
    model_key: 'embedding-query',
    model_name: 'Upstage Embedding Query',
    batch_size: 25,
    dims: 4096,
    max_tokens: 4000,
    description: 'API, 4,000 tokens, 4,096 dim - optimized for queries',
    endpoint: 'https://api.upstage.ai/v1/embeddings',
  },
  'embedding-passage': {
    model_key: 'embedding-passage',
    model_name: 'Upstage Embedding Passage',
    batch_size: 25,
    dims: 4096,
    max_tokens: 4000,
    description: 'API, 4,000 tokens, 4,096 dim - optimized for passages',
    endpoint: 'https://api.upstage.ai/v1/embeddings',
  },
};

/**
 * Adapter for Upstage's embedding API
 * Uses OpenAI-compatible request/response format
 */
export class UpstageEmbedAdapter extends EmbedModelApiAdapter {
  /**
   * Estimate token count for input text
   * Uses character-based estimation (3.5 chars per token for Korean/English mixed)
   * @param input - Input to estimate tokens for
   * @returns Estimated token count
   */
  estimate_tokens(input: string | object): number {
    if (typeof input === 'object') input = JSON.stringify(input);
    return Math.ceil((input as string).length / 3.5);
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
   * Prepare input text for embedding
   * Handles token limit truncation
   * @param embed_input - Raw input text
   * @returns Processed input text
   */
  async prepare_embed_input(embed_input: string): Promise<string | null> {
    if (typeof embed_input !== 'string') {
      throw new TypeError('embed_input must be a string');
    }

    if (embed_input.length === 0) {
      console.log('Warning: prepare_embed_input received an empty string');
      return null;
    }

    const tokens = await this.count_tokens(embed_input);
    if (tokens <= this.max_tokens) {
      return embed_input;
    }

    return await this.trim_input_to_max_tokens(embed_input, tokens);
  }

  /**
   * Get the request adapter class
   */
  get req_adapter(): typeof UpstageEmbedRequestAdapter {
    return UpstageEmbedRequestAdapter;
  }

  /**
   * Get the response adapter class
   */
  get res_adapter(): typeof UpstageEmbedResponseAdapter {
    return UpstageEmbedResponseAdapter;
  }
}

/**
 * Request adapter for Upstage embedding API
 */
class UpstageEmbedRequestAdapter extends EmbedModelRequestAdapter {
  /**
   * Prepare request body for Upstage API (OpenAI-compatible format)
   */
  prepare_request_body(): Record<string, any> {
    return {
      model: this.model_id,
      input: this.embed_inputs,
    };
  }
}

/**
 * Response adapter for Upstage embedding API
 */
class UpstageEmbedResponseAdapter extends EmbedModelResponseAdapter {
  /**
   * Parse Upstage API response (OpenAI-compatible format)
   */
  parse_response(): EmbedResult[] {
    const resp = this.response;
    if (!resp || !resp.data || !resp.usage) {
      console.error('Invalid response format', resp);
      return [];
    }

    const avg_tokens = resp.usage.total_tokens / resp.data.length;
    return resp.data.map((item: any) => ({
      vec: item.embedding,
      tokens: avg_tokens,
    }));
  }
}
