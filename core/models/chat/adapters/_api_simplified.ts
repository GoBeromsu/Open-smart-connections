/**
 * @file _api_simplified.ts
 * @description Simplified API adapter base class using Obsidian's requestUrl()
 * This is a streamlined version that removes SmartModel dependencies
 */

import { requestUrl } from 'obsidian';
import { SmartStreamer } from '../streamer';
import { ChatModelAdapter, type AdapterConfig, type AdapterDefaults } from './_adapter';
import type {
  ChatRequest,
  ChatResponse,
  ChatMessage,
  StreamHandlers,
  ModelInfo,
  ToolCall,
  ToolDefinition,
} from '../../../types/models';

export interface HttpRequestParams {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Simplified API adapter base class
 * Handles HTTP requests and streaming for API-based chat models
 */
export abstract class ApiAdapter extends ChatModelAdapter {
  private active_stream: SmartStreamer | null = null;
  protected model_data_cache: Record<string, ModelInfo> = {};
  protected model_data_loaded_at: number = 0;

  /**
   * Get the API endpoint
   */
  protected get endpoint(): string {
    const defaults = (this.constructor as typeof ChatModelAdapter).defaults;
    return defaults.endpoint || '';
  }

  /**
   * Get the streaming endpoint
   */
  protected get endpoint_streaming(): string {
    const defaults = (this.constructor as typeof ChatModelAdapter).defaults;
    return defaults.endpoint_streaming as string || this.endpoint;
  }

  /**
   * Get the models endpoint
   */
  protected get models_endpoint(): string {
    const defaults = (this.constructor as typeof ChatModelAdapter).defaults;
    return defaults.models_endpoint as string || '';
  }

  /**
   * Build authorization headers
   */
  protected build_auth_headers(options: {
    headers?: Record<string, string>;
    api_key_header?: string;
  } = {}): Record<string, string> {
    const headers = options.headers || {};
    const api_key_header = options.api_key_header || 'Authorization';

    if (this.api_key) {
      if (api_key_header === 'Authorization') {
        headers['Authorization'] = `Bearer ${this.api_key}`;
      } else {
        headers[api_key_header] = this.api_key;
      }
    }

    return headers;
  }

  /**
   * Make an HTTP request using Obsidian's requestUrl()
   */
  protected async request(params: HttpRequestParams): Promise<any> {
    try {
      const response = await requestUrl({
        url: params.url,
        method: params.method,
        headers: params.headers || {},
        body: params.body,
        contentType: 'application/json',
        throw: false,
      });

      if (response.status >= 400) {
        throw new Error(`HTTP ${response.status}: ${response.text}`);
      }

      return {
        json: async () => {
          if (typeof response.json === 'object') {
            return response.json;
          }
          return JSON.parse(response.text);
        },
        text: response.text,
        status: response.status,
      };
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * Complete a chat request
   */
  async complete(req: ChatRequest): Promise<ChatResponse> {
    const request_params = this.prepare_request(req, false);
    const http_resp = await this.request(request_params);
    const json_resp = await http_resp.json();
    return this.parse_response(json_resp);
  }

  /**
   * Stream a chat response
   */
  async stream(req: ChatRequest, handlers: StreamHandlers = {}): Promise<string> {
    const request_params = this.prepare_request(req, true);

    return await new Promise((resolve, reject) => {
      try {
        this.active_stream = new SmartStreamer(request_params.url, {
          method: request_params.method,
          headers: request_params.headers,
          body: request_params.body,
        });

        let accumulated_text = '';

        this.active_stream.addEventListener('message', async (e: any) => {
          if (this.is_end_of_stream(e)) {
            this.stop_stream();
            handlers.onClose?.(accumulated_text);
            resolve(accumulated_text);
            return;
          }

          try {
            const chunk_text = this.parse_stream_chunk(e.data);
            if (chunk_text) {
              accumulated_text += chunk_text;
              handlers.onChunk?.(chunk_text);
            }
          } catch (error: any) {
            console.error('Error processing stream chunk:', error);
            handlers.onError?.(error);
            this.stop_stream();
            reject(error);
          }
        });

        this.active_stream.addEventListener('error', (e: any) => {
          console.error('Stream error:', e);
          const error = new Error(e.data || 'Stream error');
          handlers.onError?.(error);
          this.stop_stream();
          reject(error);
        });

        handlers.onOpen?.();
        this.active_stream.stream();
      } catch (err: any) {
        console.error('Failed to start stream:', err);
        handlers.onError?.(err);
        this.stop_stream();
        reject(err);
      }
    });
  }

  /**
   * Stop active stream
   */
  stop_stream(): void {
    if (this.active_stream) {
      this.active_stream.end();
      this.active_stream = null;
    }
  }

  /**
   * Prepare request parameters
   * Override in subclasses for platform-specific formatting
   */
  protected prepare_request(req: ChatRequest, streaming: boolean): HttpRequestParams {
    const model_key = req.model_key || this.model_key;
    const messages = req.messages || [];

    const body: any = {
      model: model_key,
      messages: messages,
      stream: streaming,
    };

    if (req.max_tokens) body.max_tokens = req.max_tokens;
    if (req.temperature !== undefined) body.temperature = req.temperature;
    if (req.tools) body.tools = req.tools;

    const defaults = (this.constructor as typeof ChatModelAdapter).defaults;
    const headers = this.build_auth_headers({
      headers: {
        'Content-Type': 'application/json',
        ...(defaults.headers || {}),
      },
      api_key_header: defaults.api_key_header,
    });

    return {
      url: streaming ? this.endpoint_streaming : this.endpoint,
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    };
  }

  /**
   * Parse response to ChatResponse format
   * Override in subclasses for platform-specific parsing
   */
  protected parse_response(resp: any): ChatResponse {
    // Default OpenAI-compatible format
    const choice = resp.choices?.[0];
    if (!choice) {
      return {
        error: 'No choices in response',
      };
    }

    return {
      message: choice.message,
      text: choice.message?.content || '',
      tool_calls: choice.message?.tool_calls,
      usage: resp.usage,
      finish_reason: choice.finish_reason,
    };
  }

  /**
   * Parse streaming chunk
   * Override in subclasses for platform-specific parsing
   */
  protected parse_stream_chunk(chunk: string): string {
    // Default OpenAI format: "data: {...}"
    if (!chunk || chunk === '[DONE]') return '';

    const data_match = chunk.match(/^data: (.+)$/);
    if (!data_match) return '';

    try {
      const json = JSON.parse(data_match[1]);
      const delta = json.choices?.[0]?.delta;
      return delta?.content || '';
    } catch (error) {
      console.warn('Failed to parse stream chunk:', chunk);
      return '';
    }
  }

  /**
   * Check if stream event indicates end of stream
   */
  protected is_end_of_stream(event: any): boolean {
    return event.data === 'data: [DONE]' || event.data.includes('[DONE]');
  }

  /**
   * Count tokens (default implementation)
   * Override in subclasses for accurate counting
   */
  async count_tokens(input: string | object): Promise<number> {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    // Rough estimate: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  /**
   * Test API key by attempting to fetch models or make a test request
   */
  async test_api_key(): Promise<void> {
    if (!this.api_key) {
      throw new Error('API key not configured');
    }

    if (this.models_endpoint) {
      await this.get_models();
    } else {
      // Make a minimal test request
      const test_req: ChatRequest = {
        messages: [{ role: 'user', content: 'test' }],
        max_tokens: 1,
      };
      await this.complete(test_req);
    }
  }

  /**
   * Get available models from API
   */
  async get_models(refresh: boolean = false): Promise<Record<string, ModelInfo>> {
    if (!refresh && this.model_data_cache && Object.keys(this.model_data_cache).length > 0) {
      return this.model_data_cache;
    }

    if (!this.models_endpoint) {
      return this.models; // Return static models
    }

    try {
      const response = await this.request({
        url: this.models_endpoint,
        method: 'GET',
        headers: this.build_auth_headers(),
      });

      const json = await response.json();
      this.model_data_cache = this.parse_model_data(json);
      this.model_data_loaded_at = Date.now();
      return this.model_data_cache;
    } catch (error) {
      console.error('Failed to fetch models:', error);
      return this.models; // Fallback to static models
    }
  }

  /**
   * Parse model data from API response
   * Override in subclasses for platform-specific parsing
   */
  protected parse_model_data(data: any): Record<string, ModelInfo> {
    // Default implementation for OpenAI-compatible APIs
    if (!data.data || !Array.isArray(data.data)) {
      return {};
    }

    return data.data.reduce((acc: Record<string, ModelInfo>, model: any) => {
      acc[model.id] = {
        model_key: model.id,
        model_name: model.id,
        max_tokens: model.max_tokens,
      };
      return acc;
    }, {});
  }
}
