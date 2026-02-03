import {
  SmartEmbedModelApiAdapter,
  SmartEmbedModelRequestAdapter,
  SmartEmbedModelResponseAdapter,
} from "./_api.js";

/**
 * Adapter for Upstage's embedding API
 * Handles API communication for Upstage Solar embedding models
 * Uses OpenAI-compatible request/response format
 * @extends SmartEmbedModelApiAdapter
 */
export class SmartEmbedUpstageAdapter extends SmartEmbedModelApiAdapter {
  static defaults = {
    adapter: 'upstage',
    description: 'Upstage (API)',
    default_model: 'embedding-query',
    endpoint: 'https://api.upstage.ai/v1/embeddings',
  };

  /**
   * Estimate token count for input text
   * Uses character-based estimation (3.5 chars per token for Korean/English mixed)
   * @param {string|Object} input - Input to estimate tokens for
   * @returns {number} Estimated token count
   */
  estimate_tokens(input) {
    if (typeof input === "object") input = JSON.stringify(input);
    return Math.ceil(input.length / 3.5);
  }

  /**
   * Count tokens in input text using estimation
   * @param {string} input - Text to tokenize
   * @returns {Promise<Object>} Token count result
   */
  async count_tokens(input) {
    return { tokens: this.estimate_tokens(input) };
  }

  /**
   * Prepare input text for embedding
   * Handles token limit truncation
   * @param {string} embed_input - Raw input text
   * @returns {Promise<string|null>} Processed input text
   */
  async prepare_embed_input(embed_input) {
    if (typeof embed_input !== "string") {
      throw new TypeError("embed_input must be a string");
    }

    if (embed_input.length === 0) {
      console.log("Warning: prepare_embed_input received an empty string");
      return null;
    }

    const { tokens } = await this.count_tokens(embed_input);
    if (tokens <= this.max_tokens) {
      return embed_input;
    }

    return await this.trim_input_to_max_tokens(embed_input, tokens);
  }

  /**
   * Get the request adapter class.
   * @returns {SmartEmbedUpstageRequestAdapter} The request adapter class
   */
  get req_adapter() {
    return SmartEmbedUpstageRequestAdapter;
  }

  /**
   * Get the response adapter class.
   * @returns {SmartEmbedUpstageResponseAdapter} The response adapter class
   */
  get res_adapter() {
    return SmartEmbedUpstageResponseAdapter;
  }

  /** @returns {number} Maximum tokens per input */
  get max_tokens() {
    return this.model_config.max_tokens || 4000;
  }

  /** @returns {Object} Settings configuration for Upstage adapter */
  get settings_config() {
    return {
      ...super.settings_config,
      "[ADAPTER].api_key": {
        name: "Upstage API key",
        type: "password",
        description: "Get your API key from console.upstage.ai",
        placeholder: "up_...",
      },
    };
  }

  /**
   * Get available models
   * @returns {Promise<Object>} Map of model objects
   */
  get_models() {
    return Promise.resolve(this.models);
  }

  get models() {
    return {
      "embedding-query": {
        id: "embedding-query",
        batch_size: 25,
        dims: 4096,
        max_tokens: 4000,
        name: "Upstage Embedding Query",
        description: "API, 4,000 tokens, 4,096 dim - optimized for queries",
        endpoint: "https://api.upstage.ai/v1/embeddings",
        adapter: "upstage",
      },
      "embedding-passage": {
        id: "embedding-passage",
        batch_size: 25,
        dims: 4096,
        max_tokens: 4000,
        name: "Upstage Embedding Passage",
        description: "API, 4,000 tokens, 4,096 dim - optimized for passages",
        endpoint: "https://api.upstage.ai/v1/embeddings",
        adapter: "upstage",
      },
    };
  }
}

/**
 * Request adapter for Upstage embedding API
 * @class SmartEmbedUpstageRequestAdapter
 * @extends SmartEmbedModelRequestAdapter
 */
class SmartEmbedUpstageRequestAdapter extends SmartEmbedModelRequestAdapter {
  /**
   * Prepare request body for Upstage API (OpenAI-compatible format)
   * @returns {Object} Request body for API
   */
  prepare_request_body() {
    return {
      model: this.adapter.model_config.id,
      input: this.embed_inputs,
    };
  }
}

/**
 * Response adapter for Upstage embedding API
 * @class SmartEmbedUpstageResponseAdapter
 * @extends SmartEmbedModelResponseAdapter
 */
class SmartEmbedUpstageResponseAdapter extends SmartEmbedModelResponseAdapter {
  /**
   * Parse Upstage API response (OpenAI-compatible format)
   * @returns {Array<Object>} Parsed embedding results
   */
  parse_response() {
    const resp = this.response;
    if (!resp || !resp.data || !resp.usage) {
      console.error("Invalid response format", resp);
      return [];
    }
    const avg_tokens = resp.usage.total_tokens / resp.data.length;
    return resp.data.map((item) => ({
      vec: item.embedding,
      tokens: avg_tokens,
    }));
  }
}
