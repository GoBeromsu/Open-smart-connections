import {
  SmartEmbedModelApiAdapter,
  SmartEmbedModelRequestAdapter,
  SmartEmbedModelResponseAdapter,
} from "./_api";
import type { AdapterDefaults, EmbedInput, EmbedResult, ModelInfo, SettingsConfigEntry } from '../../types';

/**
 * Normalize LM Studio model
 * Pure and reusable.
 * @param {any} list - Response from LM Studio `/v1/models` endpoint
 * @param {string} [adapter_key='lm_studio'] - Adapter identifier
 * @returns {Record<string, ModelInfo>} Parsed models map
 */
export function parse_lm_studio_models(list: any, adapter_key: string = 'lm_studio'): Record<string, ModelInfo> {
  if (list.object !== "list" || !Array.isArray(list.data)) {
    return { _: { id: "No models found." } };
  }
  console.log("LM Studio models", list);
  return list.data
    .filter((m: any) => m.id && m.type === "embeddings")
    .reduce((acc: Record<string, ModelInfo>, m: any) => {
      acc[m.id] = {
        id: m.id,
        model_name: m.id,
        max_tokens: m.loaded_context_length || 512,
        description: `LM Studio model: ${m.id}`,
        adapter: adapter_key,
      };
      return acc;
    }, {})
  ;
}

export class LmStudioEmbedModelAdapter extends SmartEmbedModelApiAdapter {
  static key: string = "lm_studio";

  static defaults: AdapterDefaults = {
    description: "LM Studio",
    type: "API",
    host: "http://localhost:1234",
    // endpoint: "/v1/embeddings",
    endpoint: "/api/v0/embeddings",
    models_endpoint: "/api/v0/models",
    default_model: "",               // user picks from dropdown
    streaming: false,
    api_key: "na",                   // not used
  };

  get req_adapter(): typeof LmStudioEmbedModelRequestAdapter {
    return LmStudioEmbedModelRequestAdapter;
  }
  get res_adapter(): typeof LmStudioEmbedModelResponseAdapter {
    return LmStudioEmbedModelResponseAdapter;
  }

  get host(): string {
    return this.model.data.host || (this.constructor as typeof LmStudioEmbedModelAdapter).defaults.host;
  }

  get endpoint(): string {
    return `${this.host}${(this.constructor as typeof LmStudioEmbedModelAdapter).defaults.endpoint}`;
  }

  get models_endpoint(): string {
    return `${this.host}${(this.constructor as typeof LmStudioEmbedModelAdapter).defaults.models_endpoint}`;
  }

  get settings_config(): Record<string, SettingsConfigEntry> {
    // Start with the base fields then prune / add.
    const cfg: Record<string, SettingsConfigEntry> = { ...super.settings_config };
    delete cfg["[ADAPTER].api_key"];
    cfg["[ADAPTER].refresh_models"] = {
      name: 'Refresh Models',
      type: "button",
      description: "Refresh the list of available models.",
      callback: 'adapter.refresh_models',
    };
    cfg["[ADAPTER].current_model"] = {
      name: 'Current Model Info',
      type: "html",
    };
    cfg["[ADAPTER].batch_size"] = {
      name: 'Embedding Batch Size',
      type: "number",
      description: "Number of embeddings to process in parallel. Adjusting this may improve performance.",
      default: (this.constructor as typeof LmStudioEmbedModelAdapter).defaults.batch_size,
    };
    cfg["[ADAPTER].cors_note"] = {
      name: "CORS required",
      type: "html",
    };
    return cfg;
  }

  async get_models(refresh: boolean = false): Promise<Record<string, ModelInfo>> {
    if (!refresh && this.model.data.provider_models) return this.model.data.provider_models;

    const resp = await this.http_adapter.request({
      url: this.models_endpoint,
      method: "GET",
    });
    const raw = await resp.json();
    const parsed = this.parse_model_data(raw);
    this.model.data.provider_models = parsed;
    this.model.re_render_settings();
    return parsed;
  }

  parse_model_data(list: any): Record<string, ModelInfo> {
    return parse_lm_studio_models(list, (this.constructor as typeof LmStudioEmbedModelAdapter).key);
  }

  async count_tokens(input: string): Promise<{ tokens: number }> {             // just a wrapper
    return { tokens: this.estimate_tokens(input) };
  }
  /**
   * Prepare input text and ensure it fits within `max_tokens`.
   * @param {string} embed_input - Raw input text
   * @returns {Promise<string|null>} Processed input text
   */
  async prepare_embed_input(embed_input: string): Promise<string | null> {
    if (typeof embed_input !== 'string') throw new TypeError('embed_input must be a string');
    if (embed_input.length === 0) return null;

    const { tokens } = await this.count_tokens(embed_input);
    if (tokens <= (this.max_tokens || 0)) return embed_input;

    return await this.trim_input_to_max_tokens(embed_input, tokens);
  }
  /**
   * Refresh available models.
   */
  refresh_models(): void {
    console.log('refresh_models');
    this.get_models(true);
  }

  // no usage stats from LM Studio so need to estimate tokens
  async embed_batch(inputs: EmbedInput[]): Promise<EmbedInput[]> {
    const token_cts = inputs.map((item) => this.estimate_tokens(item.embed_input || ''));
    const resp = await super.embed_batch(inputs);
    resp.forEach((item, idx) => { item.tokens = token_cts[idx] });
    return resp;
  }

}

/**
 * Request adapter for LM Studio embedding API
 * @class LmStudioEmbedModelRequestAdapter
 * @extends SmartEmbedModelRequestAdapter
 */
class LmStudioEmbedModelRequestAdapter extends SmartEmbedModelRequestAdapter {
  /**
   * Prepare request body for LM Studio API
   * @returns {Record<string, any>} Request body for API
   */
  prepare_request_body(): Record<string, any> {
    const body = {
      model: this.model_id,
      input: this.embed_inputs,
    };
    return body;
  }
}

/**
 * Response adapter for LM Studio embedding API
 * @class LmStudioEmbedModelResponseAdapter
 * @extends SmartEmbedModelResponseAdapter
 */
class LmStudioEmbedModelResponseAdapter extends SmartEmbedModelResponseAdapter {
  /**
   * Parse LM Studio API response
   * @returns {EmbedResult[]} Parsed embedding results
   */
  parse_response(): EmbedResult[] {
    const resp = this.response;
    if (!resp || !resp.data) {
      console.error("Invalid response format", resp);
      return [];
    }
    return resp.data.map((item: any) => ({
      vec: item.embedding,
      tokens: 0, // LM Studio doesn't provide token usage
    }));
  }
}
