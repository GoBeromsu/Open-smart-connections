import { SmartChatModelApiAdapter, SmartChatModelRequestAdapter, SmartChatModelResponseAdapter } from './_api';
import type { AdapterDefaults, ModelInfo, ChatMessage, ContentPart } from '../../types';

/**
 * Adapter for OpenRouter's API.
 * Provides access to multiple model providers through a unified API.
 * @class SmartChatModelOpenRouterAdapter
 * @extends SmartChatModelApiAdapter
 *
 */
export class SmartChatModelOpenRouterAdapter extends SmartChatModelApiAdapter {
  static key = 'open_router';
  static models_dev_key = 'openrouter';
  static defaults: AdapterDefaults = {
    description: 'Open Router',
    type: 'API',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    streaming: true,
    adapter: 'OpenRouter',
    models_endpoint: 'https://openrouter.ai/api/v1/models',
    default_model: 'mistralai/mistral-7b-instruct:free',
    signup_url: 'https://accounts.openrouter.ai/sign-up?redirect_url=https%3A%2F%2Fopenrouter.ai%2Fkeys',
  };

  /**
   * Get request adapter class
   * @returns {typeof SmartChatModelOpenRouterRequestAdapter} Request adapter class
   */
  get req_adapter(): typeof SmartChatModelOpenRouterRequestAdapter { return SmartChatModelOpenRouterRequestAdapter; }

  /**
   * Get response adapter class
   * @returns {typeof SmartChatModelOpenRouterResponseAdapter} Response adapter class
   */
  get res_adapter(): typeof SmartChatModelOpenRouterResponseAdapter { return SmartChatModelOpenRouterResponseAdapter; }

  /**
   * Count tokens in input text (rough estimate)
   * @param {string|object} input - Text to count tokens for
   * @returns {Promise<number>} Estimated token count
   */
  async count_tokens(input: string | object): Promise<number> {
    // OpenRouter doesn't provide a token counting endpoint, so we'll use a rough estimate
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    return Math.ceil(text.length / 4); // Rough estimate: 1 token ~ 4 characters
  }

  get models_request_params(): any {
    return {
      url: this.models_endpoint,
      method: 'GET',
    };
  }

  /**
   * Parse model data from OpenRouter API response
   * @param {any} model_data - Raw model data
   * @returns {Record<string, ModelInfo>} Map of model objects with capabilities and limits
   */
  parse_model_data(model_data: any): Record<string, ModelInfo> {
    if(model_data.data) {
      model_data = model_data.data;
    }
    if(model_data.error) throw new Error(model_data.error);
    return model_data.reduce((acc: Record<string, ModelInfo>, model: any) => {
      acc[model.id] = {
        model_name: model.id,
        id: model.id,
        max_input_tokens: model.context_length,
        name: model.name,
        description: model.name,
        long_desc: model.description,
        multimodal: model.architecture.modality === 'multimodal',
        raw: model,
      };
      return acc;
    }, {});
  }
}

/**
 * Request adapter for OpenRouter API
 * @class SmartChatModelOpenRouterRequestAdapter
 * @extends SmartChatModelRequestAdapter
 */
export class SmartChatModelOpenRouterRequestAdapter extends SmartChatModelRequestAdapter {
  to_platform(stream: boolean = false): any {
    const req = this.to_openai(stream);
    return req;
  }

  _get_openai_content(message: ChatMessage): string | ContentPart[] {
    // if user message
    if(message.role === 'user'){
      // if content is an array and all parts are type 'text'
      if(Array.isArray(message.content) && (message.content as ContentPart[]).every(part => part.type === 'text')){
        return (message.content as ContentPart[]).map(part => part.text!).join('\n');
      }
    }
    return message.content;
  }
}
/**
 * Response adapter for OpenRouter API
 * @class SmartChatModelOpenRouterResponseAdapter
 * @extends SmartChatModelResponseAdapter
 */
export class SmartChatModelOpenRouterResponseAdapter extends SmartChatModelResponseAdapter {
  static get platform_res(): any {
    return {
      id: '',
      object: 'chat.completion',
      created: 0,
      model: '',
      choices: [],
      usage: {},
    };
  }
  to_platform(): any { return this.to_openai(); }
  get object(): string { return 'chat.completion'; }
  get error(): any | null {
    if(!this._res.error) return null;
    const error = this._res.error;
    if(!error.message) error.message = '';
    if(this._res.error.metadata?.raw){
      if(typeof this._res.error.metadata.raw === 'string'){
        error.message += `\n\n${this._res.error.metadata.raw}`;
      }else{
        error.message += `\n\n${JSON.stringify(this._res.error.metadata.raw, null, 2)}`;
      }
    }
    if(error.message.startsWith('No cookie auth')) {
      error.suggested_action = 'Ensure your Open Router API key is set correctly.';
    }
    return error;
  }
}
