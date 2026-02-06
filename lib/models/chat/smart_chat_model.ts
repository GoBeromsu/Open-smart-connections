import { SmartModel } from "smart-model";
import { normalize_error } from 'smart-utils/normalize_error.js';
import type { SmartModelOpts, SettingsConfigEntry, ChatRequest, StreamHandlers, ChatCompletionResponse } from '../types';
import type { SmartChatModelAdapter } from './adapters/_adapter';

/**
 * SmartChatModel - A versatile class for handling chat operations using various platform adapters.
 * @extends SmartModel
 *
 * @deprecated Use SmartModels collection instead.
 * @example
 * ```javascript
 * const chatModel = new SmartChatModel({
 *   adapter: 'openai',
 *   adapters: {
 *     openai: OpenAIAdapter,
 *     custom_local: LocalAdapter,
 *   },
 *   settings: {
 *     openai: { api_key: 'your-api-key' },
 *     custom_local: { hostname: 'localhost', port: 8080 },
 *   },
 * });
 *
 * const response = await chatModel.complete({ prompt: "Hello, world!" });
 * console.log(response);
 * ```
 */
export class SmartChatModel extends SmartModel {
  scope_name: string = 'smart_chat_model';
  static defaults: Record<string, any> = {
    adapter: 'openai',
  };
  /**
   * Create a SmartChatModel instance.
   * @param {SmartModelOpts} opts - Configuration options
   */
  constructor(opts: SmartModelOpts = {}) {
    super(opts);
  }

  /**
   * Get available models.
   * @returns {Record<string, any>} Map of model objects
   */
  get models(): Record<string, any> { return this.adapter.models; }

  get can_stream(): boolean {
    return !!(this.adapter.constructor as typeof SmartChatModelAdapter).defaults.streaming;
  }

  /**
   * Complete a chat request.
   * @param {ChatRequest} req - Request parameters
   * @returns {Promise<ChatCompletionResponse>} Completion result
   */
  async complete(req: ChatRequest): Promise<ChatCompletionResponse> {
    const resp: ChatCompletionResponse = await this.invoke_adapter_method('complete', req);
    if (resp.error) {
      throw normalize_error(resp.error);
    }
    return resp;
  }

  /**
   * Stream chat responses.
   * @param {ChatRequest} req - Request parameters
   * @param {StreamHandlers} handlers - Event handlers for streaming
   * @returns {Promise<string>} Complete response text
   */
  async stream(req: ChatRequest, handlers: StreamHandlers = {}): Promise<string> {
    return await this.invoke_adapter_method('stream', req, handlers);
  }

  /**
   * Stop active stream.
   */
  stop_stream(): void {
    this.invoke_adapter_method('stop_stream');
  }

  /**
   * Count tokens in input text.
   * @param {string|object} input - Text to count tokens for
   * @returns {Promise<number>} Token count
   */
  async count_tokens(input: string | object): Promise<number> {
    return await this.invoke_adapter_method('count_tokens', input);
  }


  /**
   * Test if API key is valid.
   * @returns {Promise<void>}
   */
  async test_api_key(): Promise<void> {
    await this.invoke_adapter_method('test_api_key');
    this.re_render_settings();
  }

  /**
   * Get default model key.
   * @returns {string|undefined} Default model key
   */
  get default_model_key(): string | undefined {
    return (this.adapter.constructor as typeof SmartChatModelAdapter).defaults.default_model;
  }

  /**
   * Get current settings.
   * @returns {Record<string, any>} Settings object
   */
  get settings(): Record<string, any> {
    return this.opts.settings!;
  }


  /**
   * Get settings configuration.
   * @returns {Record<string, SettingsConfigEntry>} Settings configuration object
   */
  get settings_config(): Record<string, SettingsConfigEntry> {
    const _settings_config: Record<string, SettingsConfigEntry> = {
      adapter: {
        name: 'Chat Model Platform',
        type: "dropdown",
        description: "Select a platform/provider for chat models.",
        options_callback: 'get_platforms_as_options',
        is_scope: true, // trigger re-render of settings when changed
        callback: 'adapter_changed',
      },
      // Merge adapter-specific settings
      ...((this.adapter as any).settings_config || {}),
    };

    return this.process_settings_config(_settings_config);
  }

  /**
   * Process setting key.
   * @param {string} key - Setting key
   * @returns {string} Processed key
   */
  process_setting_key(key: string): string {
    return key.replace(/\[CHAT_ADAPTER\]/g, this.adapter_name);
  }

}
