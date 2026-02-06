import { SmartChatModelApiAdapter, SmartChatModelResponseAdapter } from "./_api";
import type { AdapterDefaults, ModelInfo, SettingsConfigEntry } from '../../types';

const EXCLUDED_PREFIXES: string[] = [
  'text-',
  'davinci',
  'babbage',
  'ada',
  'curie',
  'dall-e',
  'whisper',
  'omni',
  'tts',
  'gpt-4o-mini-tts',
  'computer-use',
  'codex',
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'gpt-4o-mini-realtime',
  'gpt-4o-realtime',
  'o4-mini-deep-research',
  'o3-deep-research',
  'gpt-image'
];
/**
 * Adapter for OpenAI's chat API.
 * Handles token counting and API communication for OpenAI chat models.
 * @class SmartChatModelOpenaiAdapter
 * @extends SmartChatModelApiAdapter
 *
 * @property {Object} static defaults - Default configuration for OpenAI adapter
 * @property {string} defaults.description - Human-readable description
 * @property {string} defaults.type - Adapter type ("API")
 * @property {string} defaults.endpoint - OpenAI API endpoint
 * @property {boolean} defaults.streaming - Whether streaming is supported
 * @property {string} defaults.models_endpoint - Endpoint for retrieving models
 * @property {string} defaults.default_model - Default model to use
 * @property {string} defaults.signup_url - URL for API key signup
 */
export class SmartChatModelOpenaiAdapter extends SmartChatModelApiAdapter {
  static key = "openai";
  static defaults: AdapterDefaults = {
    description: "OpenAI",
    type: "API",
    endpoint: "https://api.openai.com/v1/chat/completions",
    streaming: true,
    models_endpoint: "https://api.openai.com/v1/models",
    default_model: "gpt-5-nano",
    signup_url: "https://platform.openai.com/api-keys",
  };

  get res_adapter(): typeof SmartChatModelOpenaiResponseAdapter { return SmartChatModelOpenaiResponseAdapter; }

  /**
   * Parse model data from OpenAI API response.
   * Filters for GPT models and adds context window information.
   * @param {any} model_data - Raw model data from OpenAI
   * @returns {Record<string, ModelInfo>} Map of model objects with capabilities and limits
   */
  parse_model_data(model_data: any): Record<string, ModelInfo> {
    return model_data.data
      .filter((model: any) => !EXCLUDED_PREFIXES.some(m => model.id.startsWith(m)) && !model.id.includes('-instruct'))
      .reduce((acc: Record<string, ModelInfo>, model: any) => {
        const out: ModelInfo = {
          model_name: model.id,
          id: model.id,
          multimodal: true,
          max_input_tokens: get_max_input_tokens(model.id),
        };
        acc[model.id] = out;
        return acc;
      }, {})
    ;
  }

  /**
   * Override the HTTP method for fetching models.
   */
  get models_endpoint_method(): string { return 'GET'; }

  /**
   * Test the API key by attempting to fetch models.
   * @returns {Promise<boolean>} True if API key is valid
   */
  async test_api_key(): Promise<boolean> {
    const models = await this.get_models();
    return Object.keys(models).length > 0;
  }

  /**
   * Get settings configuration for OpenAI adapter.
   * Adds image resolution setting for multimodal models.
   * @returns {Record<string, SettingsConfigEntry>} Settings configuration object
   */
  get settings_config(): Record<string, SettingsConfigEntry> {
    const config = super.settings_config;
    config['[CHAT_ADAPTER].open_ai_note'] = {
      name: 'Note about using OpenAI',
      type: "html",
      description: "<b>OpenAI models:</b> Some models require extra verification steps in your OpenAI account for them to appear in the model list.",
    }
    return config;
  }
}


function get_max_input_tokens(model_id: string): number {
  if(model_id.startsWith('gpt-4.1')){
    return 1_000_000;
  }
  if(model_id.startsWith('o')){
    return 200_000;
  }
  if(model_id.startsWith('gpt-5')){
    return 400_000;
  }
  if(model_id.startsWith('gpt-4o') || model_id.startsWith('gpt-4.5') || model_id.startsWith('gpt-4-turbo')){
    return 128_000;
  }
  if(model_id.startsWith('gpt-4')){
    return 8192;
  }
  if(model_id.startsWith('gpt-3')){
    return 16385;
  }
  return 8000;
}

/**
 * Response adapter for OpenAI API
 * @class SmartChatModelOpenaiResponseAdapter
 * @extends SmartChatModelResponseAdapter
 */
class SmartChatModelOpenaiResponseAdapter extends SmartChatModelResponseAdapter {
}
