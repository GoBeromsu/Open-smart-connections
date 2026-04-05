/**
 * @file gemini.ts
 * @description Adapter for Google Gemini's embedding API
 */

import {
  EmbedModelApiAdapter,
  EmbedModelRequestAdapter,
  EmbedModelResponseAdapter,
} from './api-base';
import type { AdapterConfig, EmbedInput, EmbedResult, ModelInfo } from '../../types/models';
import { embedAdapterRegistry } from '../../domain/embed-model';

export const GEMINI_SIGNUP_URL = 'https://aistudio.google.com/apikey';
export const DEFAULT_GEMINI_EMBED_MODEL_KEY = 'gemini-embedding-001';
const GEMINI_DEFAULT_DIMS = 768;
const GEMINI_DEFAULT_BATCH_SIZE = 50;
const GEMINI_DEFAULT_MAX_TOKENS = 2048;
const GEMINI_DEFAULT_DESCRIPTION = 'API, 2,048 tokens, 768 dim';
const GEMINI_DEFAULT_TOKENIZER = {
  type: 'char-estimate' as const,
  chars_per_token: 3.0,
  safety_ratio: 0.80,
};

function buildGeminiModelInfo(modelKey: string, dims: number = GEMINI_DEFAULT_DIMS): ModelInfo {
  const isDefaultModel = modelKey === DEFAULT_GEMINI_EMBED_MODEL_KEY;

  return {
    model_key: modelKey,
    model_name: isDefaultModel ? 'Gemini Embedding' : `Gemini (${modelKey})`,
    batch_size: GEMINI_DEFAULT_BATCH_SIZE,
    dims,
    max_tokens: GEMINI_DEFAULT_MAX_TOKENS,
    description: isDefaultModel
      ? GEMINI_DEFAULT_DESCRIPTION
      : `${GEMINI_DEFAULT_DESCRIPTION} — custom Gemini model key`,
    endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${modelKey}:batchEmbedContents`,
    signup_url: GEMINI_SIGNUP_URL,
    tokenizer: GEMINI_DEFAULT_TOKENIZER,
  };
}

/**
 * Gemini embedding models configuration
 */
export const GEMINI_EMBED_MODELS: Record<string, ModelInfo> = {
  [DEFAULT_GEMINI_EMBED_MODEL_KEY]: buildGeminiModelInfo(DEFAULT_GEMINI_EMBED_MODEL_KEY),
};

/**
 * Adapter for Google Gemini's embedding API
 * Handles token counting and API communication for Gemini models
 */
export class GeminiEmbedAdapter extends EmbedModelApiAdapter {
  constructor(config: AdapterConfig) {
    super(config);

    if (!this.models[this.model_key]) {
      this.models = {
        ...this.models,
        [this.model_key]: buildGeminiModelInfo(this.model_key, this.dims || GEMINI_DEFAULT_DIMS),
      };
    }
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
  prepare_request_body(): Record<string, unknown> {
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

    const respObj = resp as Record<string, unknown> | null;
    const embeddings = respObj?.embeddings as { values?: number[] }[] | undefined;
    if (!respObj || !embeddings || !embeddings[0]?.values) {
      return [];
    }

    return embeddings.map((embedding) => {
      if (!embedding.values || embedding.values.length === 0) {
        return { vec: [], tokens: 0 };
      }
      return {
        vec: embedding.values,
        tokens: 0, // not provided by Gemini
      };
    });
  }
}

// Self-register
embedAdapterRegistry.register({
  name: 'gemini',
  displayName: 'Google Gemini',
  AdapterClass: GeminiEmbedAdapter,
  models: GEMINI_EMBED_MODELS,
  defaultDims: GEMINI_DEFAULT_DIMS,
  requiresApiKey: true,
  requiresHost: false,
  signupUrl: GEMINI_SIGNUP_URL,
  dynamicModels: true,
});
