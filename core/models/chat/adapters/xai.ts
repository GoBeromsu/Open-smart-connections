import {
  SmartChatModelApiAdapter,
  SmartChatModelRequestAdapter,
  SmartChatModelResponseAdapter,
} from './_api';
import type { AdapterDefaults, ModelInfo } from '../../types';

/**
 * Adapter for **xAI Grok** REST API.
 *
 * Grok's HTTP interface is intentionally OpenAI-compatible, so the
 * default request/response converters are sufficient.  We only need to
 * supply the Grok-specific endpoints, headers and (optionally) a model
 * list parser.
 *
 * @see https://docs.x.ai/docs/guides/chat
 * @see https://docs.x.ai/docs/api-reference#chat-completions
 *
 * @class SmartChatModelXaiAdapter
 * @extends SmartChatModelApiAdapter
 */
export class SmartChatModelXaiAdapter extends SmartChatModelApiAdapter {
  /** Human-readable platform key used by SmartChatModel */
  static key = 'xai';

  static defaults: AdapterDefaults = {
    description: 'xAI Grok',
    type: 'API',
    adapter: 'xAI_Grok',
    endpoint: 'https://api.x.ai/v1/chat/completions',
    streaming: true,
    models_endpoint: 'https://api.x.ai/v1/models',
    default_model: 'grok-3-mini-beta',
    signup_url: 'https://ide.x.ai',
  };

  /** Grok is OpenAI-compatible -> reuse the stock adapters */
  get req_adapter(): typeof SmartChatModelRequestAdapter { return SmartChatModelRequestAdapter; }
  get res_adapter(): typeof SmartChatModelResponseAdapter { return SmartChatModelResponseAdapter; }

  /* ------------------------------------------------------------------ *
   *  Model-list helpers
   * ------------------------------------------------------------------ */

  /**
   * The Grok `/v1/models` route is **GET**, not POST.
   * Override the HTTP verb so `get_models()` works.
   * @returns {string} 'GET'
   */
  get models_endpoint_method(): string { return 'GET'; }

  /**
   * Parse `/v1/models` payload to the canonical shape used by SmartChat.
   */
  parse_model_data(model_data: any = {}): Record<string, ModelInfo> {
    const list: any[] = model_data.data || model_data.models || [];
    return list.reduce((acc: Record<string, ModelInfo>, m: any) => {
      const id = m.id || m.name;
      acc[id] = {
        id,
        model_name: id,
        description: m.description || `context: ${m.context_length || 'n/a'}`,
        max_input_tokens: m.context_length || 128000,
        multimodal: !!m.modality && m.modality.includes('vision'),
        raw: m,
      };
      return acc;
    }, {});
  }

}
