import { SmartChatModelApiAdapter, SmartChatModelRequestAdapter, SmartChatModelResponseAdapter } from './_api';
import type { AdapterDefaults, ModelInfo, ChatMessage, ContentPart } from '../../types';

/**
 * Adapter for Cohere's Command API.
 * Handles API communication and message formatting for Cohere models.
 * @class SmartChatModelCohereAdapter
 * @extends SmartChatModelApiAdapter
 */
export class SmartChatModelCohereAdapter extends SmartChatModelApiAdapter {
  static key = 'cohere';
  static defaults: AdapterDefaults = {
    description: 'Cohere Command-R',
    type: 'API',
    endpoint: 'https://api.cohere.ai/v1/chat',
    streaming: false,
    adapter: 'Cohere',
    models_endpoint: 'https://api.cohere.ai/v1/models',
    default_model: 'command-r',
    signup_url: 'https://dashboard.cohere.com/welcome/register?redirect_uri=%2Fapi-keys',
  };

  /**
   * Get request adapter class
   * @returns {typeof SmartChatModelCohereRequestAdapter} Request adapter class
   */
  get req_adapter(): typeof SmartChatModelCohereRequestAdapter { return SmartChatModelCohereRequestAdapter; }

  /**
   * Get response adapter class
   * @returns {typeof SmartChatModelCohereResponseAdapter} Response adapter class
   */
  get res_adapter(): typeof SmartChatModelCohereResponseAdapter { return SmartChatModelCohereResponseAdapter; }

  /**
   * Count tokens in input text using Cohere's tokenize endpoint
   * @param {string|object} input - Text to count tokens for
   * @returns {Promise<number>} Token count
   */
  async count_tokens(input: string | object): Promise<number> {
    const req = {
      url: `${this.endpoint}/tokenize`,
      method: 'POST',
      headers: this.build_auth_headers({
        headers: {
          'Content-Type': 'application/json',
        },
        warn_missing_api_key: true,
      }),
      body: JSON.stringify({ text: typeof input === 'string' ? input : JSON.stringify(input) }),
    };
    const resp = await this.http_adapter.request(req);
    const body = await resp.json();
    return body.tokens?.length || 0;
  }

  /**
   * Parse model data from Cohere API response
   * @param {any} model_data - Raw model data from API
   * @returns {Record<string, ModelInfo>} Map of model objects with capabilities and limits
   */
  parse_model_data(model_data: any): Record<string, ModelInfo> {
    return model_data.models
      .filter((model: any) => model.name.startsWith('command-'))
      .reduce((acc: Record<string, ModelInfo>, model: any) => {
        acc[model.name] = {
          model_name: model.name,
          id: model.name,
          max_input_tokens: model.context_length,
          tokenizer_url: model.tokenizer_url,
          finetuned: model.finetuned,
          description: `Max input tokens: ${model.context_length}, Finetuned: ${model.finetuned}`,
          raw: model,
        };
        return acc;
      }, {})
    ;
  }
}

/**
 * Request adapter for Cohere API
 * @class SmartChatModelCohereRequestAdapter
 * @extends SmartChatModelRequestAdapter
 */
export class SmartChatModelCohereRequestAdapter extends SmartChatModelRequestAdapter {
  /**
   * Convert request to Cohere format
   * @returns {any} Request parameters in Cohere format
   */
  to_platform(): any { return this.to_cohere(); }

  /**
   * Convert request to Cohere format
   * @returns {any} Request parameters in Cohere format
   */
  to_cohere(): any {
    const cohere_body: any = {
      model: this.model_id,
      message: this._get_latest_user_message(),
      chat_history: this._transform_messages_to_cohere_chat_history(),
      max_tokens: this.max_tokens,
      temperature: this.temperature,
      stream: this.stream,
      ...(this.tools && { tools: this._transform_tools_to_cohere() }),
      ...(this._req.tool_choice && { tool_choice: this._req.tool_choice }),
      ...((this._req as any).preamble && { preamble: (this._req as any).preamble }),
      ...((this._req as any).conversation_id && { conversation_id: (this._req as any).conversation_id }),
      ...((this._req as any).connectors && { connectors: (this._req as any).connectors }),
      ...((this._req as any).documents && { documents: (this._req as any).documents }),
    };

    if ((this._req as any).response_format) {
      cohere_body.response_format = {
        type: (this._req as any).response_format.type,
        ...((this._req as any).response_format.schema && { schema: (this._req as any).response_format.schema }),
      };
    }

    return {
      url: this.adapter.endpoint,
      method: 'POST',
      headers: this.get_headers(),
      body: JSON.stringify(cohere_body),
    };
  }

  /**
   * Get the latest user message from the messages array
   * @returns {string} Latest user message content
   * @throws {Error} If image input is detected (not supported by Cohere)
   * @private
   */
  _get_latest_user_message(): string {
    // throw if image input
    if (this.messages.some(msg => Array.isArray(msg.content) && (msg.content as ContentPart[]).some(part => part.type === 'image_url'))) {
      throw new Error('Cohere API does not support image input');
    }
    const user_messages = this.messages.filter(msg => msg.role === 'user');
    return (user_messages[user_messages.length - 1]?.content as string) || '';
  }

  /**
   * Transform messages to Cohere chat history format
   * @returns {any[]} Messages in Cohere format
   * @private
   */
  _transform_messages_to_cohere_chat_history(): any[] {
    return this.messages.slice(0, -1).map(message => ({
      role: this._get_cohere_role(message.role),
      message: this._get_cohere_content(message.content),
    }));
  }

  /**
   * Transform role to Cohere format
   * @param {string} role - Original role
   * @returns {string} Role in Cohere format
   * @private
   */
  _get_cohere_role(role: string): string {
    const role_map: Record<string, string> = {
      system: 'SYSTEM',
      user: 'USER',
      assistant: 'CHATBOT',
      function: 'CHATBOT',
    };
    return role_map[role] || role.toUpperCase();
  }

  /**
   * Transform content to Cohere format
   * @param {string|ContentPart[]} content - Original content
   * @returns {string} Content in Cohere format
   * @throws {Error} If image input is detected
   * @private
   */
  _get_cohere_content(content: string | ContentPart[]): string {
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === 'image_url') {
          throw new Error('Cohere API does not support image input');
        }
      }
      return content.map(part => {
        if (part.type === 'text') return part.text;
        return JSON.stringify(part);
      }).join('\n');
    }
    return content;
  }

  /**
   * Transform tools to Cohere format
   * @returns {any[]} Tools in Cohere format
   * @private
   */
  _transform_tools_to_cohere(): any[] {
    return this.tools!.map(tool => ({
      name: tool.function.name,
      description: tool.function.description,
      parameters: tool.function.parameters,
    }));
  }
}

/**
 * Response adapter for Cohere API
 * @class SmartChatModelCohereResponseAdapter
 * @extends SmartChatModelResponseAdapter
 */
export class SmartChatModelCohereResponseAdapter extends SmartChatModelResponseAdapter {
  /**
   * Convert response to OpenAI format
   * @returns {any} Response in OpenAI format
   * @throws {Error} If response contains an error message
   */
  to_openai(): any {
    if (this._res.message) {
      throw new Error(this._res.message);
    }

    return {
      id: this._res.generation_id || 'cohere_' + Date.now(),
      object: 'chat.completion',
      created: Date.now(),
      model: this.adapter.model_key,
      choices: [
        {
          index: 0,
          message: this._transform_message_to_openai(),
          finish_reason: this._get_openai_finish_reason(this._res.finish_reason),
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
      content: this._res.text || '',
    };

    if (this._res.citations) {
      message.citations = this._res.citations;
    }

    if (this._res.documents) {
      message.documents = this._res.documents;
    }

    if (this._res.search_queries) {
      message.search_queries = this._res.search_queries;
    }

    if (this._res.search_results) {
      message.search_results = this._res.search_results;
    }

    return message;
  }

  /**
   * Transform finish reason to OpenAI format
   * @param {string} finish_reason - Original finish reason
   * @returns {string} Finish reason in OpenAI format
   * @private
   */
  _get_openai_finish_reason(finish_reason: string): string {
    const reason_map: Record<string, string> = {
      'COMPLETE': 'stop',
      'MAX_TOKENS': 'length',
      'ERROR': 'error',
      'STOP_SEQUENCE': 'stop',
    };
    return reason_map[finish_reason] || 'stop';
  }

  /**
   * Transform usage statistics to OpenAI format
   * @returns {any} Usage statistics in OpenAI format
   * @private
   */
  _transform_usage_to_openai(): any {
    if (!this._res.meta || !this._res.meta.billed_units) {
      return {
        prompt_tokens: null,
        completion_tokens: null,
        total_tokens: null,
      };
    }
    return {
      prompt_tokens: this._res.meta.billed_units.input_tokens || null,
      completion_tokens: this._res.meta.billed_units.output_tokens || null,
      total_tokens: (this._res.meta.billed_units.input_tokens || 0) + (this._res.meta.billed_units.output_tokens || 0),
    };
  }
}
