/**
 * @file gemini.ts
 * @description Adapter for Google Gemini's embedding API
 */

import {
  EmbedModelApiAdapter,
  EmbedModelRequestAdapter,
  EmbedModelResponseAdapter,
} from './_api';
import type { EmbedInput, EmbedResult, ModelInfo } from '../../../types/models';

/**
 * Gemini embedding models configuration
 */
export const GEMINI_EMBED_MODELS: Record<string, ModelInfo> = {
  'gemini-embedding-001': {
    model_key: 'gemini-embedding-001',
    model_name: 'Gemini Embedding',
    batch_size: 50,
    dims: 768,
    max_tokens: 2048,
    description: 'API, 2,048 tokens, 768 dim',
    endpoint:
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents',
  },
};

/**
 * Adapter for Google Gemini's embedding API
 * Handles token counting and API communication for Gemini models
 */
export class GeminiEmbedAdapter extends EmbedModelApiAdapter {
  /**
   * Count tokens in input text using tokenizer
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
  get req_adapter(): typeof GeminiEmbedRequestAdapter {
    return GeminiEmbedRequestAdapter;
  }

  /**
   * Get the response adapter class
   */
  get res_adapter(): typeof GeminiEmbedResponseAdapter {
    return GeminiEmbedResponseAdapter;
  }

  /**
   * Prepare request headers for Gemini API
   */
  prepare_request_headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-goog-api-key': this.api_key || '',
    };
  }

  /**
   * Embed batch — no retry at adapter level.
   * Errors propagate as typed TransientError/FatalError from request().
   * Pipeline handles all retry logic.
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
 * Request adapter for Gemini embedding API
 */
class GeminiEmbedRequestAdapter extends EmbedModelRequestAdapter {
  get model_id(): string {
    return `models/${this.adapter.model_key}`;
  }

  /**
   * Prepare request body for Gemini API
   */
  prepare_request_body(): Record<string, any> {
    const requests = this.embed_inputs.map((input) => {
      const [title, ...content] = input.split('\n');
      const doc_content = content.join('\n').trim() || '';

      if (doc_content.length) {
        return {
          model: this.model_id,
          content: {
            parts: [{ text: doc_content }],
          },
          outputDimensionality: this.model_dims,
          taskType: 'RETRIEVAL_DOCUMENT',
          title: title,
        };
      } else {
        return {
          model: this.model_id,
          content: {
            parts: [{ text: title }],
          },
          outputDimensionality: this.model_dims,
          taskType: 'RETRIEVAL_DOCUMENT',
        };
      }
    });

    return { requests };
  }
}

/**
 * Response adapter for Gemini embedding API
 */
class GeminiEmbedResponseAdapter extends EmbedModelResponseAdapter {
  /**
   * Parse Gemini API response
   */
  parse_response(): EmbedResult[] {
    const resp = this.response;

    if (!resp || !resp.embeddings || !resp.embeddings[0]?.values) {
      console.error('Invalid Gemini embedding response format', resp);
      return [];
    }

    return resp.embeddings.map((embedding: any, i: number) => {
      if (!embedding.values || embedding.values.length === 0) {
        console.warn(`No values for embedding at index ${i}`);
        return { vec: [], tokens: 0 };
      }
      return {
        vec: embedding.values,
        tokens: 0, // not provided by Gemini
      };
    });
  }
}
