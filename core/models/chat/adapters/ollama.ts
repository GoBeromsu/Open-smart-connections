import { SmartChatModelApiAdapter, SmartChatModelRequestAdapter, SmartChatModelResponseAdapter } from './_api';
import { normalize_error } from 'smart-utils/normalize_error.js';
import type { AdapterDefaults, ModelInfo, SettingsConfigEntry, ContentPart } from '../../types';

/**
 * Adapter for Ollama's local API.
 * Handles communication with locally running Ollama instance.
 * @class SmartChatModelOllamaAdapter
 * @extends SmartChatModelApiAdapter
 */
export class SmartChatModelOllamaAdapter extends SmartChatModelApiAdapter {
  static key = 'ollama';
  static defaults: AdapterDefaults = {
    description: 'Ollama (Local)',
    type: 'API',
    api_key: 'na',
    host: 'http://localhost:11434',
    endpoint: '/api/chat',
    models_endpoint: '/api/tags',
    streaming: true,
  };

  get req_adapter(): typeof SmartChatModelOllamaRequestAdapter { return SmartChatModelOllamaRequestAdapter; }
  get res_adapter(): typeof SmartChatModelOllamaResponseAdapter { return SmartChatModelOllamaResponseAdapter; }

  get host(): string {
    return this.model.data.host || (this.constructor as typeof SmartChatModelOllamaAdapter).defaults.host;
  }
  get endpoint(): string {
    return `${this.host}${(this.constructor as typeof SmartChatModelOllamaAdapter).defaults.endpoint}`;
  }
  get models_endpoint(): string {
    return `${this.host}${(this.constructor as typeof SmartChatModelOllamaAdapter).defaults.models_endpoint}`;
  }
  get model_show_endpoint(): string {
    return `${this.host}/api/show`;
  }
  get models_endpoint_method(): string { return 'GET'; }

  /**
   * Get available models from local Ollama instance
   * @param {boolean} [refresh=false] - Whether to refresh cached models
   * @returns {Promise<Record<string, ModelInfo>>} Map of model objects
   */
  async get_models(refresh: boolean = false): Promise<Record<string, ModelInfo>> {
    const time_now = Date.now();
    if(!refresh
      && typeof this.model_data === 'object'
      && Object.keys(this.model_data || {}).length > 0
      && this.model_data_loaded_at
      && (time_now - this.model_data_loaded_at < 1 * 60 * 60 * 1000) // cache fresh for 1 hour
    ) return this.model_data; // return cached models if not refreshing
    try {
      const list_resp = await this.http_adapter.request(this.models_request_params);
      const list_data = await list_resp.json();
      // get model details for each model in list
      const models_raw_data: any[] = [];
      for(const model of list_data.models){
        const model_details_resp = await this.http_adapter.request({
          url: this.model_show_endpoint,
          method: 'POST',
          body: JSON.stringify({model: model.name}),
        });
        const model_details_data = await model_details_resp.json();
        models_raw_data.push({...model_details_data, name: model.name});
      }
      this.model_data = this.parse_model_data(models_raw_data);
      await this.get_enriched_model_data();
      this.model.data.provider_models = this.model_data;
      if(typeof this.model.re_render_settings === 'function') {
        this.model.re_render_settings(); // re-render settings to update models dropdown
      }
      this.model_data_loaded_at = Date.now();
      return this.model_data;

    } catch (error) {
      console.error('Failed to fetch model data:', error);
      return {'_': {id: `Failed to fetch models from ${this.model.adapter_name}`}};
    }
  }

  /**
   * Parse model data from Ollama API response
   * @param {any[]} model_data - Raw model data from Ollama
   * @returns {Record<string, ModelInfo>} Map of model objects with capabilities and limits
   */
  parse_model_data(model_data: any): Record<string, ModelInfo> {
    if (!Array.isArray(model_data)) {
      this.model_data = {};
      console.error('Invalid model data format from Ollama:', model_data);
      return {};
    }

    if(model_data.length === 0){
      this.model_data = {'no_models_available': {
        id: 'no_models_available',
        name: 'No models currently available',
      }};
      return this.model_data;
    }
    return model_data
      .reduce((acc: Record<string, ModelInfo>, model: any) => {
        if(model.name.includes('embed')) return acc; // skip embedding models
        const out: ModelInfo = {
          model_name: model.name,
          id: model.name,
          multimodal: false,
          max_input_tokens: Object.entries(model.model_info).find((m: [string, any]) => m[0].includes('.context_length'))![1] as number,
        };
        acc[model.name] = out;
        return acc;
      }, {})
    ;
  }

  /**
   * Override settings config to remove API key setting since not needed for local instance
   * @returns {Record<string, SettingsConfigEntry>} Settings configuration object
   */
  get settings_config(): Record<string, SettingsConfigEntry> {
    const config = super.settings_config;
    delete config['[CHAT_ADAPTER].api_key'];
    config['[CHAT_ADAPTER].host'] = {
      name: 'Ollama host',
      type: 'text',
      description: 'Enter the host for your Ollama instance',
      default: (this.constructor as typeof SmartChatModelOllamaAdapter).defaults.host,
    };
    return config;
  }
  is_end_of_stream(event: any): boolean {
    return event.data.includes('"done_reason"');
  }
}

export class SmartChatModelOllamaRequestAdapter extends SmartChatModelRequestAdapter {
  /**
   * Convert request to Ollama format
   * @returns {any} Request parameters in Ollama format
   */
  to_platform(streaming: boolean = false): any {
    const ollama_body: any = {
      model: this.model_id,
      messages: this._transform_messages_to_ollama(),
      options: this._transform_parameters_to_ollama(),
      stream: streaming || this.stream,
    };

    if (this.tools) {
      ollama_body.tools = this._transform_functions_to_tools();
      if(this.tool_choice?.function?.name){
        ollama_body.messages[ollama_body.messages.length - 1].content += `\n\nUse the "${this.tool_choice.function.name}" tool.`;
        ollama_body.format = 'json';
      }
    }

    return {
      url: this.adapter.endpoint,
      method: 'POST',
      body: JSON.stringify(ollama_body),
    };
  }

  /**
   * Transform messages to Ollama format
   * @returns {any[]} Messages in Ollama format
   * @private
   */
  _transform_messages_to_ollama(): any[] {
    return this.messages.map(message => {
      const ollama_message: any = {
        role: message.role,
        content: this._transform_content_to_ollama(message.content),
      };

      // Extract images if present
      const images = this._extract_images_from_content(message.content);
      if (images.length > 0) {
        // remove preceeding data:image/*;base64,
        ollama_message.images = images.map(img => img.replace(/^data:image\/[^;]+;base64,/, ''));
      }

      return ollama_message;
    });
  }

  /**
   * Transform content to Ollama format
   * @param {string|ContentPart[]} content - Message content
   * @returns {string} Content in Ollama format
   * @private
   */
  _transform_content_to_ollama(content: string | ContentPart[]): string {
    if (Array.isArray(content)) {
      return content
        .filter((item: any) => item.type === 'text')
        .map((item: any) => item.text)
        .join('\n');
    }
    return content;
  }

  /**
   * Extract images from content
   * @param {string|ContentPart[]} content - Message content
   * @returns {string[]} Array of image URLs
   * @private
   */
  _extract_images_from_content(content: string | ContentPart[]): string[] {
    if (!Array.isArray(content)) return [];
    return content
      .filter((item: any) => item.type === 'image_url')
      .map((item: any) => item.image_url.url);
  }

  /**
   * Transform functions to tools format
   * @returns {any[]} Tools array in Ollama format
   * @private
   */
  _transform_functions_to_tools(): any[] {
    return this.tools!;
  }

  /**
   * Transform parameters to Ollama options format
   * @returns {any} Options in Ollama format
   * @private
   */
  _transform_parameters_to_ollama(): any {
    const options: any = {};

    if (this.max_tokens) options.num_predict = this.max_tokens;
    if (this.temperature) options.temperature = this.temperature;
    if (this.top_p) options.top_p = this.top_p;
    if (this.frequency_penalty) options.frequency_penalty = this.frequency_penalty;
    if (this.presence_penalty) options.presence_penalty = this.presence_penalty;

    return options;
  }
}

/**
 * Response adapter for Ollama API
 * @class SmartChatModelOllamaResponseAdapter
 * @extends SmartChatModelResponseAdapter
 */
export class SmartChatModelOllamaResponseAdapter extends SmartChatModelResponseAdapter {
  static get platform_res(): any {
    return {
      model: '',
      created_at: null,
      message: {
        role: '',
        content: '',
      },
      total_duration: 0,
      load_duration: 0,
      prompt_eval_count: 0,
      prompt_eval_duration: 0,
      eval_count: 0,
      eval_duration: 0,
    };
  }
  /**
   * Convert response to OpenAI format
   * @returns {any} Response in OpenAI format
   */
  to_openai(): any {
    if(this.error) return { error: normalize_error(this.error, this.status as any) };
    return {
      id: this._res.created_at,
      object: 'chat.completion',
      created: Date.now(),
      model: this._res.model,
      choices: [
        {
          index: 0,
          message: this._transform_message_to_openai(),
          finish_reason: this._res.done_reason,
        },
      ],
      usage: this._transform_usage_to_openai(),
    };
  }

  /**
   * Transform message to OpenAI format
   * @returns {any} Message in OpenAI format
   * @private
   */
  _transform_message_to_openai(): any {
    return {
      role: this._res.message.role,
      content: this._res.message.content,
      tool_calls: this._res.message.tool_calls,
    };
  }

  /**
   * Transform usage statistics to OpenAI format
   * @returns {any} Usage statistics in OpenAI format
   * @private
   */
  _transform_usage_to_openai(): any {
    return {
      prompt_tokens: this._res.prompt_eval_count || 0,
      completion_tokens: this._res.eval_count || 0,
      total_tokens: (this._res.prompt_eval_count || 0) + (this._res.eval_count || 0),
    };
  }
  /**
   * Parse chunk adds delta to content as expected output format
   */
  handle_chunk(chunk: string): string | undefined {
    const parsed = JSON.parse(chunk || '{}');
    if(parsed.created_at && !this._res.created_at){
      this._res.created_at = parsed.created_at;
    }
    let raw: string | undefined;
    if(parsed.message?.content){
      const content = parsed.message.content;
      raw = content;
      this._res.message.content += content;
    }
    if(parsed.message?.role){
      this._res.message.role = parsed.message.role;
    }
    if(parsed.model){
      this._res.model = parsed.model;
    }
    if(parsed.message?.tool_calls){
      if(!this._res.message.tool_calls){
        this._res.message.tool_calls = [{
          id: '',
          type: 'function',
          function: {
            name: '',
            arguments: '',
          },
        }];
      }
      if(parsed.message.tool_calls[0].id){
        this._res.message.tool_calls[0].id += parsed.message.tool_calls[0].id;
      }
      if(parsed.message.tool_calls[0].function.name){
        this._res.message.tool_calls[0].function.name += parsed.message.tool_calls[0].function.name;
      }
      if(parsed.message.tool_calls[0].function.arguments){
        if(typeof parsed.message.tool_calls[0].function.arguments === 'string'){
          this._res.message.tool_calls[0].function.arguments += parsed.message.tool_calls[0].function.arguments;
        }else{
          this._res.message.tool_calls[0].function.arguments = parsed.message.tool_calls[0].function.arguments;
        }
      }
    }
    return raw;
  }
}
