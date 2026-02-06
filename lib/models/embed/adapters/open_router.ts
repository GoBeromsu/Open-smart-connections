import {
  SmartEmbedModelApiAdapter,
  SmartEmbedModelRequestAdapter,
  SmartEmbedModelResponseAdapter,
} from "./_api";
import type { AdapterDefaults, EmbedResult, ModelInfo, SettingsConfigEntry } from '../../types';

/**
 * Adapter for OpenRouter's embedding API.
 * Uses OpenRouter's OpenAI-compatible /v1/embeddings endpoint and
 * dynamically discovers embedding models from /v1/models.
 *
 * @class SmartEmbedOpenRouterAdapter
 * @extends SmartEmbedModelApiAdapter
 */
export class SmartEmbedOpenRouterAdapter extends SmartEmbedModelApiAdapter {
  static key: string = "open_router";

  static defaults: AdapterDefaults = {
    description: "OpenRouter (Embeddings)",
    type: "API",
    adapter: "OpenRouterEmbeddings",
    endpoint: "https://openrouter.ai/api/v1/embeddings",
    models_endpoint: "https://openrouter.ai/api/v1/models",
    default_model: "text-embedding-3-small",
    signup_url:
      "https://accounts.openrouter.ai/sign-up?redirect_url=https%3A%2F%2Fopenrouter.ai%2Fkeys",
    streaming: false,
  };

  /**
   * Request adapter class
   * @returns {typeof SmartEmbedOpenRouterRequestAdapter}
   */
  get req_adapter(): typeof SmartEmbedOpenRouterRequestAdapter {
    return SmartEmbedOpenRouterRequestAdapter;
  }

  /**
   * Response adapter class
   * @returns {typeof SmartEmbedOpenRouterResponseAdapter}
   */
  get res_adapter(): typeof SmartEmbedOpenRouterResponseAdapter {
    return SmartEmbedOpenRouterResponseAdapter;
  }

  /**
   * Override settings config to label the API key clearly.
   * @returns {Record<string, SettingsConfigEntry>} Settings configuration for OpenRouter adapter
   */
  get settings_config(): Record<string, SettingsConfigEntry> {
    return {
      ...super.settings_config,
      "[ADAPTER].api_key": {
        name: "OpenRouter API key for embeddings",
        type: "password",
        description: "Required for OpenRouter embedding models.",
      },
    };
  }

  /**
   * Estimate token count for input text.
   * OpenRouter does not expose a tokenizer, so we use a character-based heuristic.
   * @param {string} input
   * @returns {Promise<{tokens: number}>}
   */
  async count_tokens(input: string): Promise<{ tokens: number }> {
    return { tokens: this.estimate_tokens(input) };
  }

  /**
   * Prepare input text and ensure it fits within `max_tokens`.
   * @param {string} embed_input - Raw input text
   * @returns {Promise<string|null>} Processed input text
   */
  async prepare_embed_input(embed_input: string): Promise<string | null> {
    if (typeof embed_input !== "string") {
      throw new TypeError("embed_input must be a string");
    }
    if (embed_input.length === 0) return null;

    const { tokens } = await this.count_tokens(embed_input);
    if (tokens <= (this.max_tokens || 0)) return embed_input;

    return await this.trim_input_to_max_tokens(embed_input, tokens);
  }

  /**
   * Get the OpenRouter models endpoint.
   * @returns {string} Models endpoint URL
   */
  get models_endpoint(): string {
    return (this.constructor as typeof SmartEmbedOpenRouterAdapter).defaults.models_endpoint!;
  }

  /**
   * Fetch available models from OpenRouter and filter to embedding models.
   * Results are cached in model.data.provider_models and used by the settings UI.
   *
   * @param {boolean} [refresh=false] - Force refresh of model list
   * @returns {Promise<Record<string, ModelInfo>>} Map of model objects keyed by model id
   */
  async get_models(refresh: boolean = false): Promise<Record<string, ModelInfo>> {
    if (!refresh && this.model.data.provider_models) {
      return this.model.data.provider_models;
    }

    if (!this.api_key) {
      console.warn(
        "[SmartEmbedOpenRouterAdapter] API key missing; cannot fetch models from OpenRouter."
      );
      // Fallback: minimal single default model so the dropdown is not empty
      const fallback_id = (this.constructor as typeof SmartEmbedOpenRouterAdapter).defaults.default_model!;
      const fallback_models: Record<string, ModelInfo> = {
        [fallback_id]: {
          id: fallback_id,
          model_name: fallback_id,
          description: "OpenRouter embedding model",
          max_tokens: this.max_tokens,
          adapter: (this.constructor as typeof SmartEmbedOpenRouterAdapter).key,
        },
      };
      this.model.data.provider_models = fallback_models;
      return fallback_models;
    }

    try {
      const resp = await this.http_adapter.request({
        url: this.models_endpoint,
        method: "GET",
        headers: this.build_auth_headers(),
      });
      const raw = await resp.json();
      const parsed = this.parse_model_data(raw);
      this.model.data.provider_models = parsed;
      this.model.re_render_settings();
      return parsed;
    } catch (error) {
      console.error("[SmartEmbedOpenRouterAdapter] Failed to fetch models:", error);
      // Keep any previously loaded models or a minimal fallback
      if (this.model.data.provider_models) return this.model.data.provider_models;

      const fallback_id = (this.constructor as typeof SmartEmbedOpenRouterAdapter).defaults.default_model!;
      const fallback_models: Record<string, ModelInfo> = {
        [fallback_id]: {
          id: fallback_id,
          model_name: fallback_id,
          description: "OpenRouter embedding model",
          max_tokens: this.max_tokens,
          adapter: (this.constructor as typeof SmartEmbedOpenRouterAdapter).key,
        },
      };
      this.model.data.provider_models = fallback_models;
      return fallback_models;
    }
  }

  /**
   * Parse OpenRouter /v1/models response into standard format,
   * but only keep models that look like embeddings.
   *
   * @param {any} model_data - Raw models payload from OpenRouter
   * @returns {Record<string, ModelInfo>} Map of model objects keyed by id
   */
  parse_model_data(model_data: any): Record<string, ModelInfo> {
    let list: any[] = [];
    if (Array.isArray(model_data?.data)) list = model_data.data;
    else if (Array.isArray(model_data)) list = model_data;
    else {
      console.error(
        "[SmartEmbedOpenRouterAdapter] Invalid model data format from OpenRouter:",
        model_data
      );
      return { _: { id: "No models found." } };
    }

    const out: Record<string, ModelInfo> = {};
    for (const model of list) {
      const model_id = model.id || model.name;
      if (!model_id) continue;
      if (!is_embedding_model(model_id)) continue;

      out[model_id] = {
        id: model_id,
        model_name: model_id,
        max_tokens: model.context_length || this.max_tokens,
        description: model.name || model.description || `Model: ${model_id}`,
        adapter: (this.constructor as typeof SmartEmbedOpenRouterAdapter).key,
      };
    }

    if (!Object.keys(out).length) {
      return { _: { id: "No embedding models found." } };
    }
    return out;
  }
}

/**
 * Request adapter for OpenRouter embedding API.
 * Converts standard embed requests to OpenRouter's OpenAI-style schema.
 *
 * @class SmartEmbedOpenRouterRequestAdapter
 * @extends SmartEmbedModelRequestAdapter
 */
class SmartEmbedOpenRouterRequestAdapter extends SmartEmbedModelRequestAdapter {
  /**
   * Prepare request body for OpenRouter API.
   * The embeddings endpoint is OpenAI-compatible:
   *   POST /v1/embeddings
   *   { model: string, input: string | string[] }
   *
   * @returns {Record<string, any>} Request body for API
   */
  prepare_request_body(): Record<string, any> {
    return {
      model: this.model_id,
      input: this.embed_inputs,
    };
  }
}

/**
 * Response adapter for OpenRouter embedding API.
 * Normalizes OpenRouter's OpenAI-style response into:
 *   [{ vec: number[], tokens: number|null }, ...]
 *
 * @class SmartEmbedOpenRouterResponseAdapter
 * @extends SmartEmbedModelResponseAdapter
 */
class SmartEmbedOpenRouterResponseAdapter extends SmartEmbedModelResponseAdapter {
  /**
   * Parse OpenRouter embedding response.
   * Expected shape (OpenAI-compatible):
   * {
   *   data: [{ embedding: number[], index: number, object: "embedding" }, ...],
   *   model: string,
   *   usage?: { prompt_tokens: number, total_tokens: number }
   * }
   *
   * @returns {EmbedResult[]}
   */
  parse_response(): EmbedResult[] {
    const resp = this.response;
    if (!resp || !Array.isArray(resp.data)) {
      console.error(
        "[SmartEmbedOpenRouterResponseAdapter] Invalid embedding response format:",
        resp
      );
      return [];
    }

    let avg_tokens: number = 0;
    if (resp.usage?.total_tokens && resp.data.length > 0) {
      avg_tokens = resp.usage.total_tokens / resp.data.length;
    }

    return resp.data.map((item: any) => {
      const vec = item.embedding || item.data || [];
      return {
        vec,
        tokens: avg_tokens,
      };
    });
  }
}

/**
 * Heuristic filter: true when an id looks like an embedding model.
 * Checks for common embedding-related substrings and segments.
 *
 * @param {string} id
 * @returns {boolean}
 */
const is_embedding_model = (id: string): boolean => {
  const lower = String(id || "").toLowerCase();
  const segments = lower.split(/[-:/_]/);
  if (segments.some((seg) => ["embed", "embedding", "bge"].includes(seg))) return true;
  if (lower.includes("text-embedding")) return true;
  return false;
};
