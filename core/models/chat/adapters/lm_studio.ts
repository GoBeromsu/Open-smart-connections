import { SmartChatModelApiAdapter, SmartChatModelRequestAdapter, SmartChatModelResponseAdapter } from './_api';
import type { AdapterDefaults, ModelInfo, SettingsConfigEntry } from '../../types';

/**
 * Adapter for LM Studio's OpenAI-compatible API.
 *
 * @class SmartChatModelLmStudioAdapter
 * @extends SmartChatModelApiAdapter
 */
export class SmartChatModelLmStudioAdapter extends SmartChatModelApiAdapter {
  static key = 'lm_studio';

  static defaults: AdapterDefaults = {
    description: 'LM Studio (OpenAI-compatible)',
    type: 'API',
    endpoint: 'http://localhost:1234/v1/chat/completions',
    streaming: true,
    adapter: 'LM_Studio_OpenAI_Compat',
    models_endpoint: 'http://localhost:1234/v1/models',
    default_model: '',
    signup_url: 'https://lmstudio.ai/docs/api/openai-api',
    api_key: 'no api key required',
  };

  /* ------------------------------------------------------------------ *
   *  Request / Response classes
   * ------------------------------------------------------------------ */

  get req_adapter(): typeof SmartChatModelLmStudioRequestAdapter { return SmartChatModelLmStudioRequestAdapter; }
  get res_adapter(): typeof SmartChatModelLmStudioResponseAdapter { return SmartChatModelLmStudioResponseAdapter; }

  /* ------------------------------------------------------------------ *
   *  Settings
   * ------------------------------------------------------------------ */

  /**
   * Extend the base settings with a read-only HTML block that reminds the
   * user to enable CORS inside LM Studio. The Smart View renderer treats
   * `type: "html"` as a static fragment, so no extra runtime logic is needed.
   */
  get settings_config(): Record<string, SettingsConfigEntry> {
    const config = super.settings_config;
    delete config['[CHAT_ADAPTER].api_key'];
    return {
      ...config,
      '[CHAT_ADAPTER].cors_instructions': {
        /* visible only when this adapter is selected */
        name: 'CORS required',
        type: 'html',
        description:
          '<p>Before you can use LM Studio ' +
          'you must <strong>Enable CORS</strong> ' +
          'inside LM Studio -> Developer -> Settings</p>',
      },
    };
  }

  /* ------------------------------------------------------------------ *
   *  Model list helpers
   * ------------------------------------------------------------------ */


  /**
   * LM Studio returns an OpenAI-style list; normalise to the project shape.
   */
  parse_model_data(model_data: any): Record<string, ModelInfo> {
    if (model_data.object !== 'list' || !Array.isArray(model_data.data)) {
      return { _: { id: 'No models found.' } };
    }
    const out: Record<string, ModelInfo> = {};
    for (const m of model_data.data) {
      out[m.id] = {
        id: m.id,
        model_name: m.id,
        description: `LM Studio model: ${m.id}`,
        multimodal: false,
      };
    }
    return out;
  }

  get models_endpoint_method(): string { return 'get'; }

  /**
   * Count tokens in input text (no dedicated endpoint)
   * Rough estimate: 1 token ~ 4 chars
   * @param {string|object} input
   * @returns {Promise<number>}
   */
  async count_tokens(input: string | object): Promise<number> {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    return Math.ceil(text.length / 4);
  }

  /**
   * Test API key - LM Studio doesn't require API key. Always true.
   * @returns {Promise<boolean>}
   */
  async test_api_key(): Promise<boolean> {
    return true;
  }
  get api_key(): string {
    return 'no api key required';
  }

}

/**
 * Request adapter for LM Studio OpenAI-compatible API
 * Allows forcing tool use by adding a system prompt if tool_choice is set.
 * @class SmartChatModelLmStudioRequestAdapter
 * @extends SmartChatModelRequestAdapter
 */
export class SmartChatModelLmStudioRequestAdapter extends SmartChatModelRequestAdapter {
  to_platform(streaming: boolean = false): any {
    const req = this.to_openai(streaming);
    const body = JSON.parse(req.body!);

    /* Ensure the tool forcing helper still works */
    if (this.tool_choice?.function?.name) {
      const last_msg = body.messages[body.messages.length - 1];
      if (typeof last_msg.content === 'string') {
        last_msg.content = [
          { type: 'text', text: last_msg.content },
        ];
      }
      last_msg.content.push({
        type: 'text',
        text: `Use the "${this.tool_choice.function.name}" tool.`,
      });
      // Set tool_choice to a supported string value
      body.tool_choice = 'required';
    } else if (body.tool_choice && typeof body.tool_choice === 'object') {
      // Fallback: if tool_choice is an object, set to "auto"
      body.tool_choice = 'auto';
    }

    req.body = JSON.stringify(body);
    return req;
  }
}

/**
 * Response adapter for LM Studio OpenAI-compatible API
 * LM Studio returns OpenAI-like responses directly.
 * @class SmartChatModelLmStudioResponseAdapter
 * @extends SmartChatModelResponseAdapter
 */
export class SmartChatModelLmStudioResponseAdapter extends SmartChatModelResponseAdapter {
}
