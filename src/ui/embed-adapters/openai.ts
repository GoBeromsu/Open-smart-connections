/**
 * @file openai.ts
 * @description Adapter for OpenAI's embedding API
 */

import {
  EmbedModelApiAdapter,
  EmbedModelRequestAdapter,
  EmbedModelResponseAdapter,
} from './api-base';
import type { EmbedResult, ModelInfo } from '../../types/models';
import { embedAdapterRegistry } from '../../domain/embed-model';

export const OPENAI_SIGNUP_URL = 'https://platform.openai.com/api-keys';

/**
 * OpenAI embedding models configuration
 */
export const OPENAI_EMBED_MODELS: Record<string, ModelInfo> = {
  'text-embedding-3-small': {
    model_key: 'text-embedding-3-small',
    model_name: 'OpenAI Text-3 Small',
    batch_size: 50,
    dims: 1536,
    max_tokens: 8191,
    description: 'API, 8,191 tokens, 1,536 dim',
    endpoint: 'https://api.openai.com/v1/embeddings',
    signup_url: OPENAI_SIGNUP_URL,
  },
  'text-embedding-3-large': {
    model_key: 'text-embedding-3-large',
    model_name: 'OpenAI Text-3 Large',
    batch_size: 50,
    dims: 3072,
    max_tokens: 8191,
    description: 'API, 8,191 tokens, 3,072 dim',
    endpoint: 'https://api.openai.com/v1/embeddings',
    signup_url: OPENAI_SIGNUP_URL,
  },
  'text-embedding-3-small-512': {
    model_key: 'text-embedding-3-small',
    model_name: 'OpenAI Text-3 Small - 512',
    batch_size: 50,
    dims: 512,
    max_tokens: 8191,
    description: 'API, 8,191 tokens, 512 dim',
    endpoint: 'https://api.openai.com/v1/embeddings',
    signup_url: OPENAI_SIGNUP_URL,
  },
  'text-embedding-3-large-256': {
    model_key: 'text-embedding-3-large',
    model_name: 'OpenAI Text-3 Large - 256',
    batch_size: 50,
    dims: 256,
    max_tokens: 8191,
    description: 'API, 8,191 tokens, 256 dim',
    endpoint: 'https://api.openai.com/v1/embeddings',
    signup_url: OPENAI_SIGNUP_URL,
  },
  'text-embedding-ada-002': {
    model_key: 'text-embedding-ada-002',
    model_name: 'OpenAI Ada',
    batch_size: 50,
    dims: 1536,
    max_tokens: 8191,
    description: 'API, 8,191 tokens, 1,536 dim',
    endpoint: 'https://api.openai.com/v1/embeddings',
    signup_url: OPENAI_SIGNUP_URL,
  },
};

/**
 * Adapter for OpenAI's embedding API
 * Handles token counting and API communication for OpenAI models
 */
export class OpenAIEmbedAdapter extends EmbedModelApiAdapter {
  /**
   * Count tokens in input text using OpenAI's tokenizer
   * @param input - Text to tokenize
   * @returns Token count
   */
  async count_tokens(input: string): Promise<number> {
    if (!this.tiktoken) await this.load_tiktoken();
    return this.tiktoken.encode(input).length;
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
  get req_adapter(): typeof OpenAIEmbedRequestAdapter {
    return OpenAIEmbedRequestAdapter;
  }

  /**
   * Get the response adapter class
   */
  get res_adapter(): typeof OpenAIEmbedResponseAdapter {
    return OpenAIEmbedResponseAdapter;
  }
}

/**
 * Request adapter for OpenAI embedding API
 */
class OpenAIEmbedRequestAdapter extends EmbedModelRequestAdapter {
  /**
   * Prepare request body for OpenAI API
   */
  prepare_request_body(): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model_id,
      input: this.embed_inputs,
    };

    // Add dimensions parameter for text-embedding-3 models
    if (this.model_id && this.model_id.startsWith('text-embedding-3')) {
      body.dimensions = this.model_dims;
    }

    return body;
  }
}

/**
 * Response adapter for OpenAI embedding API
 */
class OpenAIEmbedResponseAdapter extends EmbedModelResponseAdapter {
  /**
   * Parse OpenAI API response
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
  name: 'openai',
  displayName: 'OpenAI',
  AdapterClass: OpenAIEmbedAdapter,
  models: OPENAI_EMBED_MODELS,
  defaultDims: 1536,
  requiresApiKey: true,
  requiresHost: false,
  signupUrl: OPENAI_SIGNUP_URL,
});
