import { SmartHttpRequest } from 'smart-http-request';
import { SmartStreamer } from '../streamer'; // move to smart-http-request???
import { SmartChatModelAdapter } from './_adapter';
import { SmartHttpRequestFetchAdapter } from 'smart-http-request/adapters/fetch.js';
import { normalize_error } from 'smart-utils/normalize_error.js';
import type {
  AdapterDefaults,
  ChatRequest,
  ChatMessage,
  ChatCompletionResponse,
  StreamHandlers,
  SettingsConfigEntry,
  ModelInfo,
  ModelOption,
  Tool,
  ToolCall,
  ContentPart,
} from '../../types';
import type { SmartChatModel } from '../smart_chat_model';

interface ModelsDevCache {
  data: any;
  fetched_at: number;
}

interface HttpRequestParams {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
  chunk_splitting_regex?: RegExp;
}

const MODEL_ADAPTER_CACHE: Record<string, Record<string, ModelInfo>> = {}; // this is gross but makes it easy
const MODELS_DEV_CACHE: ModelsDevCache = { data: null, fetched_at: 0 };

/**
 * Base API adapter class for SmartChatModel.
 * Handles HTTP requests and response processing for remote chat services.
 * @abstract
 * @class SmartChatModelApiAdapter
 * @extends SmartChatModelAdapter
 *
 * @property {SmartHttpRequest} _http_adapter - The HTTP adapter instance
 * @property {SmartChatModelRequestAdapter} req_adapter - The request adapter class
 * @property {SmartChatModelResponseAdapter} res_adapter - The response adapter class
 */
export class SmartChatModelApiAdapter extends SmartChatModelAdapter {
  _http_adapter: any;
  model_data_loaded_at: number;
  active_stream: SmartStreamer | null;
  streaming_chunk_splitting_regex?: RegExp;

  static defaults: AdapterDefaults = {};
  static key?: string;

  constructor(model: SmartChatModel){
    super(model);
    this.model_data_loaded_at = 0;
    this.active_stream = null;
  }

  /**
   * Get the request adapter class.
   * @returns {typeof SmartChatModelRequestAdapter} The request adapter class
   */
  get req_adapter(): typeof SmartChatModelRequestAdapter { return SmartChatModelRequestAdapter; }

  /**
   * Get the response adapter class.
   * @returns {typeof SmartChatModelResponseAdapter} The response adapter class
   */
  get res_adapter(): typeof SmartChatModelResponseAdapter { return SmartChatModelResponseAdapter; }

  /**
   * Get or initialize the HTTP adapter.
   * @returns {any} The HTTP adapter instance
   */
  get http_adapter(): any {
    if (!this._http_adapter) {
      if ((this.model as any).http_adapter) this._http_adapter = (this.model as any).http_adapter;
      else if (this.model.opts.http_adapter) this._http_adapter = this.model.opts.http_adapter;
      else this._http_adapter = new SmartHttpRequest({ adapter: SmartHttpRequestFetchAdapter });
    }
    return this._http_adapter;
  }

  /**
   * Get the settings configuration for the API adapter.
   * @deprecated migrating to module export
   * @returns {Record<string, SettingsConfigEntry>} Settings configuration object with API key and other settings
   */
  get settings_config(): Record<string, SettingsConfigEntry> {
    return {
      ...super.settings_config,
      '[CHAT_ADAPTER].api_key': {
        name: 'API Key',
        type: 'password',
        description: 'Enter your API key for the chat model platform.',
        callback: 'test_api_key',
        is_scope: true, // trigger re-render of settings when changed (reload models dropdown)
      },
    };
  }

  /**
   * Count tokens in the input text.
   * @abstract
   * @param {string|object} input - Text or message object to count tokens for
   * @returns {Promise<number>} Number of tokens in the input
   */
  async count_tokens(input: string | object): Promise<number> { throw new Error('count_tokens not implemented'); }

  /**
   * Get the parameters for requesting available models.
   * @returns {HttpRequestParams} Request parameters for models endpoint
   */
  get models_request_params(): HttpRequestParams {
    return {
      url: this.models_endpoint,
      method: this.models_endpoint_method,
      headers: this.build_auth_headers({
        headers: {
          ...((this.constructor as typeof SmartChatModelApiAdapter).defaults?.headers || {}),
        },
        api_key_header: (this.constructor as typeof SmartChatModelApiAdapter).defaults?.api_key_header,
      }),
    };
  }

  async get_enriched_model_data(): Promise<Record<string, ModelInfo>> {
    const provider_key = this.provider_key;
    await this.get_models_dev_index();
    const provider_data = MODELS_DEV_CACHE.data[provider_key] || {};
    const get_limit_i = (model: any): number => model.limit?.context || 10000;
    const get_limit_o = (model: any): number => model.limit?.output || 10000;
    const get_multimodal = (model: any): boolean => model.modalities?.input?.includes('image') || false;
    if(Object.keys(this.model_data || {}).length > 0) {
      for (const [key, model] of Object.entries(this.model_data)) {
        const enriched = provider_data?.models?.[model.id];
        if (!enriched) continue;
        this.model_data[key].models_dev = enriched;
        this.model_data[key].name = enriched.name || model.name;
        this.model_data[key].max_input_tokens = get_limit_i(enriched);
        this.model_data[key].max_output_tokens = get_limit_o(enriched);
        this.model_data[key].multimodal = get_multimodal(enriched);
        this.model_data[key].cost = enriched.cost;
      }
    }else{
      for(const [key, model] of Object.entries(provider_data?.models || {}) as [string, any][]) {
        this.model_data[key] = {
          ...model,
          model_name: model.name,
          description: model.name,
          max_input_tokens: get_limit_i(model),
          max_output_tokens: get_limit_o(model),
          multimodal: get_multimodal(model),
        };
      }
    }
    return this.model_data;
  }

  valid_model_data(): boolean {
    return typeof this.model_data === 'object'
      && Object.keys(this.model_data || {}).length > 0
      && !!this.model_data_loaded_at
      && ((Date.now() - this.model_data_loaded_at) < 1 * 60 * 60 * 1000) // cache fresh for 1 hour
    ;
  }

  /**
   * Get available models from the API.
   * @param {boolean} [refresh=false] - Whether to refresh cached models
   * @returns {Promise<Record<string, ModelInfo>>} Map of model objects
   */
  async get_models(refresh: boolean = false): Promise<Record<string, ModelInfo>> {
    if(!refresh && this.valid_model_data()) return this.model_data; // return cached models if not refreshing
    if(this.api_key) {
      let response: any;
      try {
        response = await this.http_adapter.request(this.models_request_params);
        this.model_data = this.parse_model_data(await response.json());
      } catch (error) {
        console.error('Failed to fetch model data:', { error, response });
        // return {"_": {id: `Failed to fetch models from ${this.model.adapter_name}`}};
      }
    }
    this.model_data = await this.get_enriched_model_data();
    this.model_data_loaded_at = Date.now();
    if(this.model.data) {
      this.model.data.provider_models = this.model_data;
    }
    if(this.valid_model_data() && typeof this.model.re_render_settings === 'function') setTimeout(() => {
      this.model.re_render_settings();
    }, 100);
    else console.warn('Invalid model data, not re-rendering settings');
    return this.model_data;

  }

  /**
   * Parses the raw model data from OpenAI API and transforms it into a more usable format.
   * @param {any} model_data - The raw model data received from OpenAI API.
   * @abstract
   * @returns {Record<string, ModelInfo>} A map of parsed model objects.
   */
  parse_model_data(model_data: any): Record<string, ModelInfo> {
    throw new Error('parse_model_data not implemented'); // requires platform-specific implementation
  }

  /**
   * Complete a chat request.
   * @param {ChatRequest} req - Request parameters
   * @returns {Promise<ChatCompletionResponse | null>} Completion response in OpenAI format
   */
  async complete(req: ChatRequest): Promise<ChatCompletionResponse | null> {
    const _req = new (this.req_adapter)(this, {
      ...req,
      stream: false,
    });
    const request_params = _req.to_platform();
    const http_resp = await this.http_adapter.request(request_params);
    if(!http_resp) return null;
    const _res = new (this.res_adapter)(this, await http_resp.json());
    try{
      const resp = _res.to_openai();
      return resp;
    } catch (error: any) {
      const normalized_error = normalize_error(error?.data || error);
      console.error('Error in SmartChatModelApiAdapter.complete():', {normalized_error, error});
      console.error(http_resp);
      return normalized_error as any;
    }
  }

  // STREAMING

  /**
   * Stream chat responses.
   * @param {ChatRequest} req - Request parameters
   * @param {StreamHandlers} handlers - Event handlers for streaming
   * @returns {Promise<any>} Complete response object
   */
  async stream(req: ChatRequest, handlers: StreamHandlers = {}): Promise<any> {
    const _req = new (this.req_adapter)(this, req);
    const request_params: HttpRequestParams = _req.to_platform(true);
    if(this.streaming_chunk_splitting_regex) request_params.chunk_splitting_regex = this.streaming_chunk_splitting_regex; // handle Google's BS

    return await new Promise((resolve, reject) => {
      try {
        this.active_stream = new SmartStreamer(this.endpoint_streaming, request_params);
        const resp_adapter = new (this.res_adapter)(this);

        this.active_stream.addEventListener('message', async (e: any) => {
          // console.log('message', e);
          if (this.is_end_of_stream(e)) {
            await resp_adapter.handle_chunk(e.data);
            this.stop_stream();
            const final_resp = resp_adapter.to_openai();
            handlers.done && await handlers.done(final_resp);
            // should return the final aggregated response if needed
            resolve(final_resp);
            return;
          }

          try {
            const raw = resp_adapter.handle_chunk(e.data);
            handlers.chunk && await handlers.chunk({...resp_adapter.to_openai(), raw});
          } catch (error: any) {
            const normalized_error = normalize_error({...e.data, ...error});
            console.error('Error processing stream chunk:', {e, error, normalized_error});
            handlers.error && handlers.error(normalized_error);
            this.stop_stream();
            reject(normalized_error);
          }
        });

        this.active_stream.addEventListener('error', (e: any) => {
          console.error('Stream error:', e);
          const normalized_error = normalize_error(e?.data || e);
          handlers.error && handlers.error(normalized_error);
          this.stop_stream();
          reject(normalized_error);
        });

        this.active_stream.stream();
      } catch (err: any) {
        console.error('Failed to start stream:', err);
        const normalized_error = normalize_error(err?.data || err);
        handlers.error && handlers.error(normalized_error);
        this.stop_stream();
        reject(normalized_error);
      }
    });
  }

  /**
   * Check if a stream event indicates end of stream.
   * @param {any} event - Stream event
   * @returns {boolean} True if end of stream
   */
  is_end_of_stream(event: any): boolean {
    return event.data === 'data: [DONE]'; // use default OpenAI format
  }

  /**
   * Stop active stream.
   */
  stop_stream(): void {
    if (this.active_stream) {
      this.active_stream.end();
      this.active_stream = null;
    }
  }

  get models_endpoint(): string { return (this.constructor as typeof SmartChatModelApiAdapter).defaults?.models_endpoint || ''; }
  get models_endpoint_method(): string { return 'POST'; }

  /**
   * Get the endpoint URL.
   * @returns {string} The endpoint URL.
   */
  get endpoint(): string { return (this.constructor as typeof SmartChatModelApiAdapter).defaults?.endpoint || ''; }

  /**
   * Get the streaming endpoint URL.
   * @returns {string} The streaming endpoint URL.
   */
  get endpoint_streaming(): string { return (this.constructor as typeof SmartChatModelApiAdapter).defaults?.endpoint_streaming || this.endpoint; }

  /**
   * Get the maximum output tokens.
   * @returns {number} The maximum output tokens.
   */
  get max_output_tokens(): number { return this.model.data.max_output_tokens || 3000; }

  async get_models_dev_index(ttl_ms: number = 60 * 60 * 1000): Promise<any> {
    const now = Date.now();
    if (MODELS_DEV_CACHE?.data && (now - MODELS_DEV_CACHE?.fetched_at < ttl_ms)) {
      return MODELS_DEV_CACHE.data;
    }
    try {
      const req = {
        url: 'https://models.dev/api.json',
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      };
      const resp = await this.http_adapter.request(req);
      const data = await resp.json();
      MODELS_DEV_CACHE.data = data;
      MODELS_DEV_CACHE.fetched_at = now;
      console.log({MODELS_DEV_CACHE});
      return data;
    } catch (err) {
      console.warn('models.dev fetch failed; continuing without enrichment', err);
      return MODELS_DEV_CACHE.data || [];
    }
  }
  /**
   * Get available models as dropdown options synchronously.
   * @returns {ModelOption[]} Array of model options.
   */
  get_models_as_options(): ModelOption[] {
    if(Object.keys(this.model_data || {}).length){
      return Object.entries(this.model_data).map(([id, model]) => ({ value: id, name: model.name || id })).sort((a, b) => a.name.localeCompare(b.name));
    }
    this.get_models(true); // refresh models
    return [{value: '', name: 'No models currently available'}];
  }
  get model_data(): Record<string, ModelInfo> {
    if(!MODEL_ADAPTER_CACHE[(this.constructor as typeof SmartChatModelApiAdapter).key!]) MODEL_ADAPTER_CACHE[(this.constructor as typeof SmartChatModelApiAdapter).key!] = {};
    return MODEL_ADAPTER_CACHE[(this.constructor as typeof SmartChatModelApiAdapter).key!];
  }
  set model_data(data: Record<string, ModelInfo>) {
    if(!MODEL_ADAPTER_CACHE[(this.constructor as typeof SmartChatModelApiAdapter).key!]) MODEL_ADAPTER_CACHE[(this.constructor as typeof SmartChatModelApiAdapter).key!] = {};
    MODEL_ADAPTER_CACHE[(this.constructor as typeof SmartChatModelApiAdapter).key!] = data;
  }
}

/**
 * Base class for request adapters to handle various input schemas and convert them to OpenAI schema.
 * @class SmartChatModelRequestAdapter
 *
 * @property {SmartChatModelApiAdapter} adapter - The parent adapter instance
 * @property {ChatRequest} _req - The original request object
 */
export class SmartChatModelRequestAdapter {
  adapter: SmartChatModelApiAdapter;
  _req: ChatRequest;

  /**
   * @constructor
   * @param {SmartChatModelApiAdapter} adapter - The SmartChatModelAdapter instance
   * @param {ChatRequest} req - The incoming request object
   */
  constructor(adapter: SmartChatModelApiAdapter, req: ChatRequest = {}) {
    this.adapter = adapter;
    this._req = req;
  }

  /**
   * Get the messages array from the request
   * @returns {ChatMessage[]} Array of message objects
   */
  get messages(): ChatMessage[] {
    return this._req.messages || [];
  }

  /**
   * Get the model identifier
   * @returns {string|undefined} Model ID
   */
  get model_id(): string | undefined {
    return this._req.model
      || this.adapter.model?.model_key
      || this.adapter.model?.data?.id // DEPRECATED
    ;
  }

  /**
   * Get the temperature setting
   * @returns {number|undefined} Temperature value
   */
  get temperature(): number | undefined {
    return this._req.temperature;
  }

  /**
   * Get the maximum tokens setting
   * @returns {number} Max tokens value
   */
  get max_tokens(): number {
    return this._req.max_tokens || this.adapter.max_output_tokens;
  }

  /**
   * Get the streaming flag
   * @returns {boolean|undefined} Whether to stream responses
   */
  get stream(): boolean | undefined {
    return this._req.stream;
  }

  /**
   * Get the tools array
   * @returns {Tool[]|null} Array of tool objects or null
   */
  get tools(): Tool[] | null {
    return this._req.tools || null;
  }

  /**
   * Get the tool choice setting
   * @returns {string|object|null} Tool choice configuration
   */
  get tool_choice(): any {
    return this._req.tool_choice || null;
  }

  get frequency_penalty(): number | undefined {
    return this._req.frequency_penalty;
  }

  get presence_penalty(): number | undefined {
    return this._req.presence_penalty;
  }

  get top_p(): number | undefined {
    return this._req.top_p;
  }

  /**
   * Get request headers
   * @returns {Record<string, string>} Headers object
   */
  get_headers(): Record<string, string> {
    return this.adapter.build_auth_headers({
      headers: {
        'Content-Type': 'application/json',
        ...((this.adapter.constructor as typeof SmartChatModelApiAdapter).defaults?.headers || {}),
      },
      api_key_header: (this.adapter.constructor as typeof SmartChatModelApiAdapter).defaults?.api_key_header,
      warn_missing_api_key: true,
    });
  }

  /**
   * Convert request to platform-specific format
   * @returns {HttpRequestParams} Platform-specific request parameters
   */
  to_platform(streaming: boolean = false): HttpRequestParams { return this.to_openai(streaming); }

  /**
   * Convert request to OpenAI format
   * @returns {HttpRequestParams} Request parameters in OpenAI format
   */
  to_openai(streaming: boolean = false): HttpRequestParams {
    const body: any = {
      messages: this._transform_messages_to_openai(),
      model: this.model_id,
      // TODO max_completion_tokens
      temperature: this.temperature,
      stream: streaming,
      ...(this.tools && { tools: this._transform_tools_to_openai() }),
    };
    if((body.tools?.length > 0) && this.tool_choice && this.tool_choice !== 'none'){
      // no tool choice if no tools
      body.tool_choice = this.tool_choice;
    }
    // special handling for o1 models
    if(this.model_id?.startsWith('o1-')){
      body.messages = body.messages.filter((m: ChatMessage) => m.role !== 'system'); // remove system messages (not supported by o1 models)
      delete body.temperature; // not supported by o1 models
    }
    if(typeof this._req.top_p === 'number') body.top_p = this._req.top_p;
    if(typeof this._req.presence_penalty === 'number') body.presence_penalty = this._req.presence_penalty;
    if(typeof this._req.frequency_penalty === 'number') body.frequency_penalty = this._req.frequency_penalty;

    return {
      url: this.adapter.endpoint,
      method: 'POST',
      headers: this.get_headers(),
      body: JSON.stringify(body),
    };
  }

  /**
   * Transform messages to OpenAI format
   * @returns {ChatMessage[]} Transformed messages array
   * @private
   */
  _transform_messages_to_openai(): ChatMessage[] {
    return this.messages.map(message => this._transform_single_message_to_openai(message));
  }

  /**
   * Transform a single message to OpenAI format
   * @param {ChatMessage} message - Message object to transform
   * @returns {ChatMessage} Transformed message object
   * @private
   */
  _transform_single_message_to_openai(message: ChatMessage): ChatMessage {
    const transformed: ChatMessage = {
      role: this._get_openai_role(message.role),
      content: this._get_openai_content(message),
    };

    if (message.name) transformed.name = message.name;
    if (message.tool_calls) transformed.tool_calls = this._transform_tool_calls_to_openai(message.tool_calls);
    if (message.image_url) transformed.image_url = message.image_url;
    if (message.tool_call_id) transformed.tool_call_id = message.tool_call_id;

    return transformed;
  }

  /**
   * Get the OpenAI role for a given role.
   * @param {string} role - The role to transform.
   * @returns {string} The transformed role.
   * @private
   */
  _get_openai_role(role: string): string {
    // Override in subclasses if needed
    return role;
  }

  /**
   * Get the OpenAI content for a given content.
   * @param {ChatMessage} message - The message to transform.
   * @returns {string | ContentPart[]} The transformed content.
   * @private
   */
  _get_openai_content(message: ChatMessage): string | ContentPart[] {
    // Override in subclasses if needed
    return message.content;
  }

  /**
   * Transform tool calls to OpenAI format.
   * @param {ToolCall[]} tool_calls - Array of tool call objects.
   * @returns {ToolCall[]} Transformed tool calls array.
   * @private
   */
  _transform_tool_calls_to_openai(tool_calls: ToolCall[]): ToolCall[] {
    return tool_calls.map(tool_call => ({
      id: tool_call.id,
      type: tool_call.type,
      function: {
        name: tool_call.function.name,
        arguments: tool_call.function.arguments,
      },
    }));
  }

  /**
   * Transform tools to OpenAI format.
   * @returns {Tool[]} Transformed tools array.
   * @private
   */
  _transform_tools_to_openai(): Tool[] {
    return this.tools!.map(tool => ({
      type: tool.type,
      function: {
        name: tool.function.name,
        description: tool.function.description,
        parameters: tool.function.parameters,
      },
    }));
  }
}

/**
 * Base class for response adapters to handle various output schemas and convert them to OpenAI schema.
 * @class SmartChatModelResponseAdapter
 *
 * @property {SmartChatModelApiAdapter} adapter - The parent adapter instance
 * @property {any} _res - The original response object
 */
export class SmartChatModelResponseAdapter {
  adapter: SmartChatModelApiAdapter;
  _res: any;
  status: number | null;

  // must be getter to prevent erroneous assignment
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
  /**
   * @constructor
   * @param {SmartChatModelApiAdapter} adapter - The SmartChatModelAdapter instance
   * @param {any} res - The response object
   * @param {number|null} status - HTTP status code
   */
  constructor(adapter: SmartChatModelApiAdapter, res?: any, status: number | null = null) {
    this.adapter = adapter;
    this._res = res || (this.constructor as typeof SmartChatModelResponseAdapter).platform_res;
    this.status = status;
  }

  /**
   * Get response ID
   * @returns {string|null} Response ID
   */
  get id(): string | null {
    return this._res.id || null;
  }

  /**
   * Get response object type
   * @returns {string|null} Object type
   */
  get object(): string | null {
    return this._res.object || null;
  }

  /**
   * Get creation timestamp
   * @returns {number|null} Creation timestamp
   */
  get created(): number | null {
    return this._res.created || null;
  }

  /**
   * Get response choices
   * @returns {any[]} Array of choice objects
   */
  get choices(): any[] {
    return this._res.choices || [];
  }

  /**
   * Get first tool call if present
   * @returns {any|null} Tool call object
   */
  get tool_call(): any | null {
    return this.message.tool_calls?.[0] || null;
  }

  /**
   * Get tool name from first tool call
   * @returns {string|null} Tool name
   */
  get tool_name(): string | null {
    return this.tool_call?.tool_name || null;
  }

  /**
   * Get tool call parameters
   * @returns {any|null} Tool parameters
   */
  get tool_call_content(): any | null {
    return this.tool_call?.parameters || null;
  }

  /**
   * Get the first message from the response.
   * @returns {any} The message object
   */
  get message(): any {
    return this.choices?.[0]?.message || {};
  }

  /**
   * Get token usage statistics
   * @returns {any|null} Usage statistics
   */
  get usage(): any | null {
    return this._res.usage || null;
  }

  get error(): any | null {
    return this._res.error || null;
  }

  /**
   * Convert response to OpenAI format
   * @returns {any} Response in OpenAI format
   */
  to_openai(): any {
    if(this.error) return { error: normalize_error(this.error, this.status as any) };
    const res = {
      id: this.id,
      object: this.object,
      created: this.created,
      choices: this._transform_choices_to_openai(),
      usage: this._transform_usage_to_openai(),
      raw: this._res,
    };
    return res;
  }

  /**
   * Parse chunk adds delta to content as expected output format
   */
  handle_chunk(chunk: string): string | undefined {
    if(chunk === 'data: [DONE]') return;
    chunk = JSON.parse(chunk.split('data: ')[1] || '{}');
    if(Object.keys(chunk as any).length === 0) return;
    if(!this._res.choices[0]){
      this._res.choices.push({
        message: {
          index: 0,
          role: 'assistant',
          content: '',
        },
      });
    }
    if(!this._res.id){
      this._res.id = (chunk as any).id;
    }
    let raw: string | undefined;
    if((chunk as any).choices?.[0]?.delta?.content){
      const content = (chunk as any).choices[0].delta.content;
      raw = content;
      this._res.choices[0].message.content += content;
    }
    if((chunk as any).choices?.[0]?.delta?.tool_calls){
      if(!this._res.choices[0].message.tool_calls){
        this._res.choices[0].message.tool_calls = [{
          id: '',
          type: 'function',
          function: {
            name: '',
            arguments: '',
          },
        }];
      }
      if((chunk as any).choices[0].delta.tool_calls[0].id){
        this._res.choices[0].message.tool_calls[0].id += (chunk as any).choices[0].delta.tool_calls[0].id;
      }
      if((chunk as any).choices[0].delta.tool_calls[0].function.name){
        this._res.choices[0].message.tool_calls[0].function.name += (chunk as any).choices[0].delta.tool_calls[0].function.name;
      }
      if((chunk as any).choices[0].delta.tool_calls[0].function.arguments){
        this._res.choices[0].message.tool_calls[0].function.arguments += (chunk as any).choices[0].delta.tool_calls[0].function.arguments;
      }
    }
    return raw;
  }

  /**
   * Transform choices to OpenAI format.
   * @returns {any[]} Transformed choices array.
   * @private
   */
  _transform_choices_to_openai(): any[] {
    return this.choices.map(choice => ({
      index: choice.index,
      message: this._transform_message_to_openai(choice.message),
      finish_reason: this._get_openai_finish_reason(choice.finish_reason),
    }));
  }

  /**
   * Transform a single message to OpenAI format.
   * @param {any} message - The message object to transform.
   * @returns {any} Transformed message object.
   * @private
   */
  _transform_message_to_openai(message: any = {}): any {
    const transformed: any = {
      role: this._get_openai_role(message.role),
      content: this._get_openai_content(message),
    };

    if (message.name) transformed.name = message.name;
    if (message.tool_calls) transformed.tool_calls = this._transform_tool_calls_to_openai(message.tool_calls);
    if (message.image_url) transformed.image_url = message.image_url;

    return transformed;
  }

  /**
   * Get the OpenAI role for a given role.
   * @param {string} role - The role to transform.
   * @returns {string} The transformed role.
   * @private
   */
  _get_openai_role(role: string): string {
    // Override in subclasses if needed
    return role;
  }

  /**
   * Get the OpenAI content for a given content.
   * @param {any} message - The message to get content from.
   * @returns {string | ContentPart[]} The transformed content.
   * @private
   */
  _get_openai_content(message: any): string | ContentPart[] {
    // Override in subclasses if needed
    return message.content;
  }

  /**
   * Get the OpenAI finish reason for a given finish reason.
   * @param {string} finish_reason - The finish reason to transform.
   * @returns {string} The transformed finish reason.
   * @private
   */
  _get_openai_finish_reason(finish_reason: string): string {
    // Override in subclasses if needed
    return finish_reason;
  }

  /**
   * Transform usage to OpenAI format.
   * @returns {any} Transformed usage object.
   * @private
   */
  _transform_usage_to_openai(): any {
    // Override in subclasses if needed
    return this.usage;
  }

  /**
   * Transform tool calls to OpenAI format.
   * @param {ToolCall[]} tool_calls - Array of tool call objects.
   * @returns {ToolCall[]} Transformed tool calls array.
   * @private
   */
  _transform_tool_calls_to_openai(tool_calls: ToolCall[]): ToolCall[] {
    return tool_calls.map(tool_call => ({
      id: tool_call.id,
      type: tool_call.type,
      function: {
        name: tool_call.function.name,
        arguments: tool_call.function.arguments,
      },
    }));
  }
}
