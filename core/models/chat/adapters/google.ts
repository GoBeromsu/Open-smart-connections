import { SmartChatModelApiAdapter, SmartChatModelRequestAdapter, SmartChatModelResponseAdapter } from './_api';
import { normalize_error } from 'smart-utils/normalize_error.js';
import type { AdapterDefaults, ModelInfo, ChatMessage, ContentPart } from '../../types';

/**
 * Adapter for Google's Gemini API.
 * Handles API communication with Gemini models, including token counting and multimodal inputs.
 * @extends SmartChatModelApiAdapter
 */
export class SmartChatModelGoogleAdapter extends SmartChatModelApiAdapter {
  static key = 'google';

  static defaults: AdapterDefaults = {
    description: 'Google (Gemini)',
    type: 'API',
    api_key_header: 'none',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/MODEL_NAME:generateContent',
    endpoint_streaming: 'https://generativelanguage.googleapis.com/v1beta/models/MODEL_NAME:streamGenerateContent',
    streaming: true,
    adapter: 'Gemini',
    models_endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    default_model: 'gemini-1.5-pro',
    signup_url: 'https://ai.google.dev/',
  };

  declare streaming_chunk_splitting_regex: RegExp;

  constructor(model: any) {
    super(model);
    this.streaming_chunk_splitting_regex = /(\r\n|\n|\r){2}/g; // handle Google's BS (split on double newlines only)
  }

  /**
   * Get request adapter class
   */
  get req_adapter(): typeof SmartChatModelGeminiRequestAdapter { return SmartChatModelGeminiRequestAdapter; }

  /**
   * Get response adapter class
   */
  get res_adapter(): typeof SmartChatModelGeminiResponseAdapter { return SmartChatModelGeminiResponseAdapter; }

  /**
   * Uses Gemini's dedicated token counting endpoint
   */
  async count_tokens(input: string | object): Promise<number> {
    const req = {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${this.model_key}:countTokens?key=${this.api_key}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this.prepare_token_count_body(input)),
    };
    const resp = await this.http_adapter.request(req);
    return resp.json.totalTokens;
  }

  /**
   * Formats input for token counting based on type
   * @private
   */
  prepare_token_count_body(input: string | object | any[]): any {
    if (typeof input === 'string') {
      return { contents: [{ parts: [{ text: input }] }] };
    } else if (Array.isArray(input)) {
      return { contents: input.map((msg: any) => this.transform_message_for_token_count(msg)) };
    } else if (typeof input === 'object') {
      return { contents: [this.transform_message_for_token_count(input as any)] };
    }
    throw new Error('Invalid input for count_tokens');
  }

  /**
   * Transforms message for token counting, handling text and images
   * @private
   */
  transform_message_for_token_count(message: any): any {
    return {
      role: message.role === 'assistant' ? 'model' : message.role,
      parts: Array.isArray(message.content)
        ? message.content.map((part: any) => {
          if (part.type === 'text') return { text: part.text };
          if (part.type === 'image_url') return {
            inline_data: {
              mime_type: part.image_url.url.split(';')[0].split(':')[1],
              data: part.image_url.url.split(',')[1],
            },
          };
          return part;
        })
        : [{ text: message.content }],
    };
  }

  /**
   * Builds endpoint URLs with model and API key
   */
  get endpoint(): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model_key}:generateContent?key=${this.api_key}`;
  }

  get endpoint_streaming(): string {
    return `https://generativelanguage.googleapis.com/v1beta/models/${this.model_key}:streamGenerateContent?key=${this.api_key}`;
  }

  /**
   * Get models endpoint URL with API key
   * @returns {string} Complete models endpoint URL
   */
  get models_endpoint(): string {
    return `${(this.constructor as typeof SmartChatModelGoogleAdapter).defaults.models_endpoint}?key=${this.api_key}`;
  }

  /**
   * Get HTTP method for models endpoint
   * @returns {string} HTTP method ("GET")
   */
  get models_endpoint_method(): string { return 'GET'; }
  get models_request_params(): any {
    return {
      url: this.models_endpoint,
      method: this.models_endpoint_method,
    };
  }
  /**
   * Parse model data from Gemini API response
   * @param {any} model_data - Raw model data from API
   * @returns {Record<string, ModelInfo>} Map of model objects with capabilities and limits
   */
  parse_model_data(model_data: any): Record<string, ModelInfo> {
    return model_data.models
      .filter((model: any) => model.name.startsWith('models/gemini'))
      .reduce((acc: Record<string, ModelInfo>, model: any) => {
        const out: ModelInfo = {
          model_name: model.name.split('/').pop(),
          id: model.name.split('/').pop(),
          max_input_tokens: model.inputTokenLimit,
          max_output_tokens: model.maxOutputTokens,
          description: model.description,
          multimodal: model.name.includes('vision') || model.description.includes('multimodal'),
          raw: model,
        };
        acc[model.name.split('/').pop()] = out;
        return acc;
      }, {});
  }

  is_end_of_stream(event: any): boolean {
    return event.data.includes('"finishReason"');
  }
}

export class SmartChatModelGeminiRequestAdapter extends SmartChatModelRequestAdapter {
  to_platform(streaming: boolean = false): any { return this.to_gemini(streaming); }
  to_gemini(streaming: boolean = false): any {
    const gemini_body: any = {
      contents: this._transform_messages_to_gemini(),
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.max_tokens,
        topK: (this._req as any).topK || 1,
        topP: (this._req as any).topP || 1,
        stopSequences: (this._req as any).stop || [],
      },
      safetySettings: [
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_NONE',
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_NONE',
        },
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_NONE',
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_NONE',
        },
      ],
    };
    if(this.tools) gemini_body.tools = this._transform_tools_to_gemini();
    if(gemini_body.tools && (this.tool_choice !== 'none')) gemini_body.tool_config = this._transform_tool_choice_to_gemini();

    return {
      url: streaming ? this.adapter.endpoint_streaming : this.adapter.endpoint,
      method: 'POST',
      headers: this.get_headers(),
      body: JSON.stringify(gemini_body),
    };
  }

  _transform_messages_to_gemini(): any[] {
    const gemini_messages: any[] = [];
    let system_message = '';

    for (const message of this.messages) {
      if (message.role === 'system') {
        system_message += message.content + '\n';
      } else {
        gemini_messages.push({
          role: this._get_gemini_role(message.role),
          parts: this._transform_content_to_gemini(message.content),
        });
      }
    }

    if (system_message) {
      gemini_messages.unshift({
        role: 'user',
        parts: [{ text: system_message.trim() }],
      });
    }

    return gemini_messages;
  }

  _get_gemini_role(role: string): string {
    const role_map: Record<string, string> = {
      user: 'user',
      assistant: 'model',
      function: 'model', // Gemini doesn't have a function role, so we'll treat it as model
    };
    return role_map[role] || role;
  }

  _transform_content_to_gemini(content: string | ContentPart[]): any[] {
    if (Array.isArray(content)) {
      return content.map((part: any) => {
        if (part.type === 'text') return { text: part.text };
        if (part.type === 'image_url') {
          let mime_type = part.image_url.url.split(';')[0].split(':')[1];
          if (mime_type === 'image/jpg') mime_type = 'image/jpeg'; // server rejects jpg mimeType for some reason
          return {
            inline_data: {
              mime_type: mime_type,
              data: part.image_url.url.split(',')[1],
            },
          };
        }
        if (part.type === 'file' && part.file?.filename?.toLowerCase().endsWith('.pdf')) {
          if (part.file?.file_data) {
            return {
              inline_data: {
                mime_type: 'application/pdf',
                data: part.file.file_data.split(',')[1],
              },
            };
          }
        }
        return part;
      });
    }
    return [{ text: content }];
  }

  _transform_tools_to_gemini(): any[] {
    return [{
      function_declarations: this.tools!.map(tool => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      })),
    }];
  }

  _transform_tool_choice_to_gemini(): any {
    return {
      function_calling_config: {
        mode: 'ANY',
        allowed_function_names: this.tools!.map(tool => tool.function.name),
      },
    };
  }
}

export class SmartChatModelGeminiResponseAdapter extends SmartChatModelResponseAdapter {
  static get platform_res(): any {
    return {
      candidates: [{
        content: {
          parts: [
            {
              text: '',
            },
          ],
          role: '',
        },
        finishReason: '',
      }],
      promptFeedback: {},
      usageMetadata: {},
    };
  }
  to_openai(): any {
    if(this.error) return { error: normalize_error(this.error, this.status as any) };
    const first_candidate = this._res.candidates[0];
    if(!this._res.id) this._res.id = 'gemini-' + Date.now().toString();
    return {
      id: this._res.id,
      object: 'chat.completion',
      created: Date.now(),
      model: this.adapter.model_key,
      choices: [{
        index: 0,
        message: first_candidate?.content ? this._transform_message_to_openai(first_candidate.content) : '',
        finish_reason: this._get_openai_finish_reason(first_candidate.finishReason),
      }],
      usage: this._transform_usage_to_openai(),
    };
  }

  _transform_message_to_openai(content: any): any {
    const message: any = {
      role: 'assistant',
      content: content.parts.filter((part: any) => part.text).map((part: any) => part.text).join(''),
    };

    const function_call = content.parts.find((part: any) => part.functionCall);
    if (function_call) {
      message.tool_calls = [{
        type: 'function',
        function: {
          name: function_call.functionCall.name,
          arguments: JSON.stringify(function_call.functionCall.args),
        },
      }];
    }

    return message;
  }

  _get_openai_finish_reason(finish_reason: string): string {
    const reason_map: Record<string, string> = {
      'STOP': 'stop',
      'MAX_TOKENS': 'length',
      'SAFETY': 'content_filter',
      'RECITATION': 'content_filter',
      'OTHER': 'null',
    };
    return reason_map[finish_reason] || finish_reason.toLowerCase();
  }

  _transform_usage_to_openai(): any {
    if (!this._res.usageMetadata) {
      return {
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
      };
    }
    return {
      prompt_tokens: this._res.usageMetadata.promptTokenCount || null,
      completion_tokens: this._res.usageMetadata.candidatesTokenCount || null,
      total_tokens: this._res.usageMetadata.totalTokenCount || null,
    };
  }

  handle_chunk(chunk: string): string | undefined {
    let chunk_trimmed = chunk.trim();
    if(['[',','].includes(chunk_trimmed[0])) chunk_trimmed = chunk_trimmed.slice(1);
    if([']',','].includes(chunk_trimmed[chunk_trimmed.length - 1])) chunk_trimmed = chunk_trimmed.slice(0, -1);
    const data = JSON.parse(chunk_trimmed);

    // Merge candidates content parts text
    let raw: string | undefined;
    if (data.candidates?.[0]?.content?.parts?.[0]?.text?.length) {
      const content = data.candidates[0].content.parts[0].text;
      raw = content;
      this._res.candidates[0].content.parts[0].text += content;
    }
    if(data.candidates?.[0]?.content?.role?.length){
      this._res.candidates[0].content.role = data.candidates[0].content.role;
    }
    if(data.candidates?.[0]?.finishReason?.length){
      this._res.candidates[0].finishReason += data.candidates[0].finishReason;
    }
    // Merge prompt feedback
    if (data.promptFeedback) {
      this._res.promptFeedback = {
        ...(this._res.promptFeedback || {}),
        ...data.promptFeedback,
      };
    }

    // Merge usage metadata
    if (data.usageMetadata) {
      this._res.usageMetadata = {
        ...(this._res.usageMetadata || {}),
        ...data.usageMetadata,
      };
    }

    // tool calls
    if(data.candidates?.[0]?.content?.parts?.[0]?.functionCall){
      if(!this._res.candidates[0].content.parts[0].functionCall){
        this._res.candidates[0].content.parts[0].functionCall = {
          name: '',
          args: {} as Record<string, any>,
        };
      }
      this._res.candidates[0].content.parts[0].functionCall.name += data.candidates[0].content.parts[0].functionCall.name;
      if(data.candidates[0].content.parts[0].functionCall.args){
        Object.entries(data.candidates[0].content.parts[0].functionCall.args).forEach(([key, value]: [string, any]) => {
          if(!this._res.candidates[0].content.parts[0].functionCall.args[key]){
            this._res.candidates[0].content.parts[0].functionCall.args[key] = '';
          }
          this._res.candidates[0].content.parts[0].functionCall.args[key] += value;
        });
      }
    }
    return raw;
  }

}


/**
 * Included for backward compatibility.
 * @deprecated use SmartChatModelGoogleAdapter instead
 */
export class SmartChatModelGeminiAdapter extends SmartChatModelGoogleAdapter {
  static key = 'gemini';
  static defaults: AdapterDefaults = {
    description: 'Gemini (SWITCH TO **GOOGLE** ADAPTER)',
    type: 'API',
    api_key_header: 'none',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/MODEL_NAME:generateContent',
    endpoint_streaming: 'https://generativelanguage.googleapis.com/v1beta/models/MODEL_NAME:streamGenerateContent',
    streaming: true,
    adapter: 'Gemini',
    models_endpoint: 'https://generativelanguage.googleapis.com/v1beta/models',
    default_model: 'gemini-1.5-pro',
    signup_url: 'https://ai.google.dev/',
  };
}
