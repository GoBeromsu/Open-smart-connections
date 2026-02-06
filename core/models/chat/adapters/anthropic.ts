import {
  SmartChatModelApiAdapter,
  SmartChatModelRequestAdapter,
  SmartChatModelResponseAdapter,
} from './_api';
import { normalize_error } from 'smart-utils/normalize_error.js';
import type { AdapterDefaults, ModelInfo, ChatMessage, ContentPart, ToolCall } from '../../types';

/**
 * Adapter for Anthropic's Claude API.
 * Handles API communication and message formatting for Claude models.
 *
 * @class SmartChatModelAnthropicAdapter
 * @extends SmartChatModelApiAdapter
 */
export class SmartChatModelAnthropicAdapter extends SmartChatModelApiAdapter {
  static key = 'anthropic';

  static defaults: AdapterDefaults = {
    description: 'Anthropic Claude',
    type: 'API',
    endpoint: 'https://api.anthropic.com/v1/messages',
    streaming: true,
    api_key_header: 'x-api-key',
    headers: {
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'tools-2024-04-04',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    adapter: 'Anthropic',
    models_endpoint: false as any,
    default_model: 'claude-opus-4-1-20250805',
    signup_url: 'https://console.anthropic.com/login?returnTo=%2Fsettings%2Fkeys',
  };

  /**
   * Get request adapter class
   * @returns {typeof SmartChatModelAnthropicRequestAdapter} Request adapter class
   */
  get req_adapter(): typeof SmartChatModelAnthropicRequestAdapter { return SmartChatModelAnthropicRequestAdapter; }

  /**
   * Get response adapter class
   * @returns {typeof SmartChatModelAnthropicResponseAdapter} Response adapter class
   */
  get res_adapter(): typeof SmartChatModelAnthropicResponseAdapter { return SmartChatModelAnthropicResponseAdapter; }

  /**
   * Get available models (hardcoded list) and enrich via models.dev
   * @returns {Promise<Record<string, ModelInfo>>} Map of model objects
   */
  async get_models(): Promise<Record<string, ModelInfo>> {
    try {
      // this.model_data = this.anthropic_models; // do not set: prevents importing additional models
      this.model_data = await this.get_enriched_model_data();
      this.model_data_loaded_at = Date.now();
      this.model.data.provider_models = this.model_data;
      setTimeout(() => {
        this.model.re_render_settings();
      }, 100);
      return this.model_data;
    } catch {
      return this.anthropic_models; // fallback
    }
  }

  is_end_of_stream(event: any): boolean {
    return event.data.includes('message_stop');
  }

  /**
   * Get hardcoded list of available models
   * @deprecated use get_enriched_model_data() instead (remove after no-incidents)
   * @returns {Record<string, ModelInfo>} Map of model objects with capabilities and limits
   */
  get anthropic_models(): Record<string, ModelInfo> {
    return {
      // -- Claude 4 family --

      'claude-opus-4-1-20250805': {
        name: 'Claude Opus 4.1 (2025-08-05)',
        id: 'claude-opus-4-1-20250805',
        model_name: 'claude-opus-4-1-20250805',
        description: 'Anthropic Claude Opus 4.1 snapshot (2025-08-05)',
        max_input_tokens: 200_000,
        max_output_tokens: 32_000,
        multimodal: true,
      },

      'claude-opus-4-20250514': {
        name: 'Claude Opus 4 (2025-05-14)',
        id: 'claude-opus-4-20250514',
        model_name: 'claude-opus-4-20250514',
        description: 'Anthropic Claude Opus 4 snapshot (2025-05-14)',
        max_input_tokens: 200_000,
        max_output_tokens: 32_000,
        multimodal: true,
      },

      'claude-sonnet-4-20250514': {
        name: 'Claude Sonnet 4 (2025-05-14)',
        id: 'claude-sonnet-4-20250514',
        model_name: 'claude-sonnet-4-20250514',
        description: 'Anthropic Claude Sonnet 4 snapshot (2025-05-14)',
        max_input_tokens: 200_000,
        max_output_tokens: 64_000,
        multimodal: true,
      },

      // -- Claude 3.7 family --

      'claude-3-7-sonnet-latest': {
        name: 'Claude 3.7 Sonnet (latest)',
        id: 'claude-3-7-sonnet-latest',
        model_name: 'claude-3-7-sonnet-latest',
        description: 'Anthropic Claude 3.7 Sonnet (rolling-latest)',
        max_input_tokens: 200_000,
        max_output_tokens: 64_000,
        multimodal: true,
      },

      'claude-3-7-sonnet-20250219': {
        name: 'Claude 3.7 Sonnet (2025-02-19)',
        id: 'claude-3-7-sonnet-20250219',
        model_name: 'claude-3-7-sonnet-20250219',
        description: 'Anthropic Claude 3.7 Sonnet snapshot (2025-02-19)',
        max_input_tokens: 200_000,
        max_output_tokens: 64_000,
        multimodal: true,
      },

      // -- Claude 3.5 family --

      'claude-3-5-sonnet-latest': {
        name: 'Claude 3.5 Sonnet (latest)',
        id: 'claude-3-5-sonnet-latest',
        model_name: 'claude-3-5-sonnet-latest',
        description: 'Anthropic Claude 3.5 Sonnet (rolling-latest)',
        max_input_tokens: 200_000,
        max_output_tokens: 8_192,
        multimodal: true,
      },

      'claude-3-5-sonnet-20241022': {
        name: 'Claude 3.5 Sonnet (2024-10-22)',
        id: 'claude-3-5-sonnet-20241022',
        model_name: 'claude-3-5-sonnet-20241022',
        description: 'Anthropic Claude 3.5 Sonnet snapshot (2024-10-22)',
        max_input_tokens: 200_000,
        max_output_tokens: 8_192,
        multimodal: true,
      },

      'claude-3-5-haiku-latest': {
        name: 'Claude 3.5 Haiku (latest)',
        id: 'claude-3-5-haiku-latest',
        model_name: 'claude-3-5-haiku-latest',
        description: 'Anthropic Claude 3.5 Haiku (rolling-latest)',
        max_input_tokens: 200_000,
        max_output_tokens: 8_192,
      },

      'claude-3-5-haiku-20241022': {
        name: 'Claude 3.5 Haiku (2024-10-22)',
        id: 'claude-3-5-haiku-20241022',
        model_name: 'claude-3-5-haiku-20241022',
        description: 'Anthropic Claude 3.5 Haiku snapshot (2024-10-22)',
        max_input_tokens: 200_000,
        max_output_tokens: 8_192,
      },

      // -- Claude 3 family --

      'claude-3-opus-latest': {
        name: 'Claude 3 Opus (latest)',
        id: 'claude-3-opus-latest',
        model_name: 'claude-3-opus-latest',
        description: 'Anthropic Claude 3 Opus (rolling-latest)',
        max_input_tokens: 200_000,
        max_output_tokens: 4_096,
        multimodal: true,
      },

      'claude-3-opus-20240229': {
        name: 'Claude 3 Opus (2024-02-29)',
        id: 'claude-3-opus-20240229',
        model_name: 'claude-3-opus-20240229',
        description: 'Anthropic Claude 3 Opus snapshot (2024-02-29)',
        max_input_tokens: 200_000,
        max_output_tokens: 4_096,
        multimodal: true,
      },

      'claude-3-sonnet-20240229': {
        name: 'Claude 3 Sonnet (2024-02-29)',
        id: 'claude-3-sonnet-20240229',
        model_name: 'claude-3-sonnet-20240229',
        description: 'Anthropic Claude 3 Sonnet snapshot (2024-02-29)',
        max_input_tokens: 200_000,
        max_output_tokens: 4_096,
        multimodal: true,
      },

      'claude-3-haiku-20240307': {
        name: 'Claude 3 Haiku (2024-03-07)',
        id: 'claude-3-haiku-20240307',
        model_name: 'claude-3-haiku-20240307',
        description: 'Anthropic Claude 3 Haiku snapshot (2024-03-07)',
        max_input_tokens: 200_000,
        max_output_tokens: 4_096,
        multimodal: true,
      },
    };
  }
}

/**
 * Request adapter for Anthropic API
 * @class SmartChatModelAnthropicRequestAdapter
 * @extends SmartChatModelRequestAdapter
 */
export class SmartChatModelAnthropicRequestAdapter extends SmartChatModelRequestAdapter {
  anthropic_body: any;

  /**
   * Convert request to Anthropic format
   * @returns {any} Request parameters in Anthropic format
   */
  to_platform(streaming: boolean = false): any { return this.to_anthropic(streaming); }

  /**
   * Convert request to Anthropic format
   * @returns {any} Request parameters in Anthropic format
   */
  to_anthropic(streaming: boolean = false): any {
    this.anthropic_body = {
      model: this.model_id,
      max_tokens: this.max_tokens,
      temperature: this.temperature,
      stream: streaming,
    };

    /* system / user / assistant / tool messages -------------------------------- */
    this.anthropic_body.messages = this._transform_messages_to_anthropic();

    /* optional tool integration ------------------------------------------------ */
    if (this.tools) {
      this.anthropic_body.tools = this._transform_tools_to_anthropic();
    }
    if (this.tool_choice) {
      this.anthropic_body.tool_choice =
        this.tool_choice === 'auto'
          ? { type: 'auto' }
          : { type: 'tool', name: this.tool_choice.function.name };
    }

    return {
      url: this.adapter.endpoint,
      method: 'POST',
      headers: this.get_headers(),
      body: JSON.stringify(this.anthropic_body),
    };
  }

  /**
   * Transform messages to Anthropic format
   * @returns {any[]} Messages in Anthropic format
   * @private
   */
  _transform_messages_to_anthropic(): any[] {
    const anthropic_messages: any[] = [];

    for (const message of this.messages) {
      if (message.role === 'system') {
        if(!this.anthropic_body.system) this.anthropic_body.system = '';
        else this.anthropic_body.system += '\n\n';
        this.anthropic_body.system += Array.isArray(message.content) ? (message.content as ContentPart[]).map(part => part.text).join('\n') : message.content;
      } else if (message.role === 'tool') {
        const msg = {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: message.tool_call_id,
              content: message.content,
            },
          ],
        };
        anthropic_messages.push(msg);
      } else {
        const msg: any = {
          role: this._get_anthropic_role(message.role),
          content: this._get_anthropic_content(message.content),
        };
        if(message.tool_calls && message.tool_calls.length > 0) msg.content = this._transform_tool_calls_to_content(message.tool_calls);
        anthropic_messages.push(msg);
      }
    }

    return anthropic_messages;
  }

  /**
   * Transform tool calls to Anthropic format
   * @param {ToolCall[]} tool_calls - Tool calls
   * @returns {any[]} Tool calls in Anthropic format
   * @private
   */
  _transform_tool_calls_to_content(tool_calls: ToolCall[]): any[] {
    return tool_calls.map(tool_call => ({
      type: 'tool_use',
      id: tool_call.id,
      name: tool_call.function.name,
      input: JSON.parse(tool_call.function.arguments),
    }));
  }


  /**
   * Transform role to Anthropic format
   * @param {string} role - Original role
   * @returns {string} Role in Anthropic format
   * @private
   */
  _get_anthropic_role(role: string): string {
    const role_map: Record<string, string> = {
      function: 'assistant', // Anthropic doesn't have a function role, so we'll treat it as assistant
      tool: 'user',
    };
    return role_map[role] || role;
  }

  /**
   * Transform content to Anthropic format
   * @param {string|ContentPart[]} content - Original content
   * @returns {string|any[]} Content in Anthropic format
   * @private
   */
  _get_anthropic_content(content: string | ContentPart[]): string | any[] {
    if (Array.isArray(content)) {
      return content.map((item: any) => {
        if (item.type === 'text') return { type: 'text', text: item.text };
        if (item.type === 'image_url') {
          return {
            type: 'image',
            source: {
              type: 'base64',
              media_type: item.image_url.url.split(';')[0].split(':')[1],
              data: item.image_url.url.split(',')[1],
            },
          };
        }

        if (item.type === 'file' && item.file?.filename?.toLowerCase().endsWith('.pdf')) {
          if (item.file?.file_data) {
            return {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: item.file.file_data.split(',')[1],
              },
            };
          }
        }

        return item;
      });
    }
    return content;
  }

  /**
   * Transform tools to Anthropic format
   * @returns {any[]|undefined} Tools in Anthropic format
   * @private
   */
  _transform_tools_to_anthropic(): any[] | undefined {
    if (!this.tools) return undefined;
    return this.tools.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      input_schema: tool.function.parameters,
    }));
  }
}

/**
 * Response adapter for Anthropic API
 * @class SmartChatModelAnthropicResponseAdapter
 * @extends SmartChatModelResponseAdapter
 */
export class SmartChatModelAnthropicResponseAdapter extends SmartChatModelResponseAdapter {
  static get platform_res(): any {
    return {
      content: [],
      id: '',
      model: '',
      role: 'assistant',
      stop_reason: null,
      stop_sequence: null,
      type: 'message',
      usage: {
        input_tokens: 0,
        output_tokens: 0,
      },
    };
  }
  /**
   * Convert response to OpenAI format
   * @returns {any} Response in OpenAI format
   */
  to_openai(): any {
    if(this.error) return { error: normalize_error(this.error, this.status as any) };
    return {
      id: this._res.id,
      object: 'chat.completion',
      created: Date.now(),
      choices: [
        {
          index: 0,
          message: this._transform_message_to_openai(),
          finish_reason: this._get_openai_finish_reason(this._res.stop_reason),
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
    const message: any = {
      role: 'assistant',
      content: '',
      tool_calls: [] as any[],
    };

    if (Array.isArray(this._res.content)) {
      for (const content of this._res.content) {
        if (content.type === 'text') {
          message.content += (message.content ? '\n\n' : '') + content.text;
        } else if (content.type === 'tool_use') {
          message.tool_calls.push({
            id: content.id,
            type: 'function',
            function: {
              name: content.name,
              arguments: JSON.stringify(content.input),
            },
          });
        }
      }
    } else {
      message.content = this._res.content;
    }

    if (message.tool_calls.length === 0) {
      delete message.tool_calls;
    }

    return message;
  }

  /**
   * Transform finish reason to OpenAI format
   * @param {string} stop_reason - Original finish reason
   * @returns {string} Finish reason in OpenAI format
   * @private
   */
  _get_openai_finish_reason(stop_reason: string): string {
    const reason_map: Record<string, string> = {
      'end_turn': 'stop',
      'max_tokens': 'length',
      'tool_use': 'function_call',
    };
    return reason_map[stop_reason] || stop_reason;
  }

  /**
   * Transform usage statistics to OpenAI format
   * @returns {any} Usage statistics in OpenAI format
   * @private
   */
  _transform_usage_to_openai(): any {
    if (!this._res.usage) {
      return {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };
    }
    return {
      prompt_tokens: this._res.usage.input_tokens || 0,
      completion_tokens: this._res.usage.output_tokens || 0,
      total_tokens: (this._res.usage.input_tokens || 0) + (this._res.usage.output_tokens || 0),
    };
  }


  handle_chunk(chunk: string): string | undefined {
    if(!chunk.startsWith('data: ')) return;
    const parsed = JSON.parse(chunk.slice(6));
    // Initialize response structure if needed
    if (!this._res.content.length) {
      this._res.content = [
        {
          type: 'text',
          text: '',
        },
      ];
    }

    if(parsed.message?.id) {
      this._res.id = parsed.message.id;
    }
    if(parsed.message?.model) {
      this._res.model = parsed.message.model;
    }
    if(parsed.message?.role) {
      this._res.role = parsed.message.role;
    }
    let raw: string | undefined;
    if(parsed.delta?.type === 'text_delta') {
      const content = parsed.delta?.text;
      raw = content;
      this._res.content[0].text += content;
    }
    if(parsed.delta?.stop_reason) {
      this._res.stop_reason = parsed.delta.stop_reason;
    }
    if(parsed.usage) {
      this._res.usage = {
        ...this._res.usage,
        ...parsed.usage,
      };
    }
    return raw;
  }
}
