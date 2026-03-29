/**
 * @file upstage.ts
 * @description Adapter for Upstage's embedding API
 */

import {
  EmbedModelApiAdapter,
  EmbedModelRequestAdapter,
  EmbedModelResponseAdapter,
} from './api-base';
import type { EmbedResult, ModelInfo } from '../../types/models';
import { embedAdapterRegistry } from '../../domain/embed-model';

export const UPSTAGE_SIGNUP_URL = 'https://console.upstage.ai/';

/**
 * Upstage embedding models configuration
 */
/**
 * Upstage Solar embedding models.
 * Both models share the same 4096-dim vector space.
 * - Use `embedding-passage` for indexing documents
 * - Use `embedding-query` for search queries
 * The adapter handles this split automatically.
 */
/**
 * Single user-facing model. The adapter internally uses `embedding-passage`
 * for document indexing and switches to `embedding-query` for search via
 * `embed_query()`. Both share the same 4096-dim vector space.
 */
export const UPSTAGE_EMBED_MODELS: Record<string, ModelInfo> = {
  'embedding-passage': {
    model_key: 'embedding-passage',
    model_name: 'Upstage Solar (passage)',
    batch_size: 50,
    dims: 4096,
    max_tokens: 4000,
    description: 'API, 4,000 tokens, 4,096 dim — Korean-optimized, for indexing documents',
    endpoint: 'https://api.upstage.ai/v1/embeddings',
    tokenizer: {
      type: 'char-estimate',
      chars_per_token: 1.2,
      safety_ratio: 0.9,
    },
  },
  'embedding-query': {
    model_key: 'embedding-query',
    model_name: 'Upstage Solar (query)',
    batch_size: 50,
    dims: 4096,
    max_tokens: 4000,
    description: 'API, 4,000 tokens, 4,096 dim — Korean-optimized, for search queries',
    endpoint: 'https://api.upstage.ai/v1/embeddings',
    tokenizer: {
      type: 'char-estimate',
      chars_per_token: 1.2,
      safety_ratio: 0.9,
    },
  },
};

/**
 * Adapter for Upstage's embedding API
 * Uses OpenAI-compatible request/response format
 */
export class UpstageEmbedAdapter extends EmbedModelApiAdapter {
  /**
   * Prepare input text for embedding
   * Handles token limit truncation
   * @param embed_input - Raw input text
   * @returns Processed input text
   */
  async prepare_embed_input(embed_input: string): Promise<string | null> {
    if (typeof embed_input !== 'string') throw new TypeError('embed_input must be a string');
    if (embed_input.length === 0) return null;
    const tokens = await this.count_tokens(embed_input);
    if (tokens <= this.request_token_budget) return embed_input;
    return await this.trim_input_to_max_tokens(embed_input, tokens);
  }

  /**
   * Override embed_query to use embedding-query model for search queries.
   * Both query and passage models share the same 4096-dim vector space,
   * so query vectors can be compared directly against passage vectors.
   */
  async embed_query(query: string): Promise<EmbedResult[]> {
    const originalKey = this.model_key;
    this.model_key = 'embedding-query';
    try {
      return await this.embed_batch([{ embed_input: query }]);
    } finally {
      this.model_key = originalKey;
    }
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
  prepare_request_body(): Record<string, unknown> {
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
    const resp = this.response as Record<string, unknown> | null;
    const data = resp?.data as { embedding: number[] }[] | undefined;
    const usage = resp?.usage as { total_tokens: number } | undefined;
    if (!resp || !data || !usage) {
      return [];
    }

    const avg_tokens = usage.total_tokens / data.length;
    return data.map((item) => ({
      vec: item.embedding,
      tokens: avg_tokens,
    }));
  }
}

// Self-register
embedAdapterRegistry.register({
  name: 'upstage',
  displayName: 'Upstage Solar',
  AdapterClass: UpstageEmbedAdapter,
  models: UPSTAGE_EMBED_MODELS,
  defaultDims: 4096,
  requiresApiKey: true,
  requiresHost: false,
  signupUrl: UPSTAGE_SIGNUP_URL,
  supportsBatch: true,
});
