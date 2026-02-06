import { SmartChatModelApiAdapter, SmartChatModelRequestAdapter, SmartChatModelResponseAdapter } from './_api';
import type { AdapterDefaults, ModelInfo, ChatMessage, ContentPart } from '../../types';

/**
 * Adapter for Groq API.
 * This adapter assumes the Groq endpoint provides a format similar to OpenAI.
 * The main difference from openai.js: When processing assistant messages with array or null content, we merge into a single string.
 */
export class SmartChatModelGroqAdapter extends SmartChatModelApiAdapter {
  static key = 'groq';
  static defaults: AdapterDefaults = {
    description: 'Groq',
    type: 'API',
    endpoint: 'https://api.groq.com/openai/v1/chat/completions',
    streaming: true,
    adapter: 'Groq',
    models_endpoint: 'https://api.groq.com/openai/v1/models',
    default_model: 'llama3-8b-8192',
    signup_url: 'https://groq.com',
  };

  /**
   * Request adapter class
   * @returns {typeof SmartChatModelGroqRequestAdapter}
   */
  get req_adapter(): typeof SmartChatModelGroqRequestAdapter { return SmartChatModelGroqRequestAdapter; }

  /**
   * Response adapter class
   * @returns {typeof SmartChatModelGroqResponseAdapter}
   */
  get res_adapter(): typeof SmartChatModelGroqResponseAdapter { return SmartChatModelGroqResponseAdapter; }

  get models_endpoint_method(): string { return 'GET'; }

  /**
   * Parse model data from Groq API format to a dictionary keyed by model ID.
   */
  parse_model_data(model_data: any): Record<string, ModelInfo> {
    if (model_data.object !== 'list' || !Array.isArray(model_data.data)) {
      return {'_': { id: 'No models found.' }};
    }

    const parsed: Record<string, ModelInfo> = {};
    for (const m of model_data.data) {
      parsed[m.id] = {
        model_name: m.id,
        id: m.id,
        max_input_tokens: m.context_window || 8192,
        description: `Owned by: ${m.owned_by}, context: ${m.context_window}`,
        multimodal: m.id.includes('vision'),
      };
    }
    return parsed;
  }

}

/**
 * Request adapter for Groq API
 * @class SmartChatModelGroqRequestAdapter
 * @extends SmartChatModelRequestAdapter
 */
export class SmartChatModelGroqRequestAdapter extends SmartChatModelRequestAdapter {
  _get_openai_content(message: ChatMessage): string | ContentPart[] {
    if(['assistant', 'tool'].includes(message.role)){
      // merge messages with array or null content into a single string
      if(Array.isArray(message.content)) {
        return message.content.map((part: any) => {
          if (typeof part === 'string') return part;
          if (part?.text) return part.text;
          return '';
        }).join('\n');
      }
    }
    return message.content;
  }
}

/**
 * Response adapter for Groq API
 * @class SmartChatModelGroqResponseAdapter
 * @extends SmartChatModelResponseAdapter
 */
export class SmartChatModelGroqResponseAdapter extends SmartChatModelResponseAdapter {
}
