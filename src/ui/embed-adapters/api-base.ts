/**
 * @file api-base.ts
 * @description Public API adapter base classes.
 */

import type { EmbedInput, EmbedResult, ModelInfo } from '../../types/models';
import type { TokenizerProvider } from '../../domain/tokenizer-provider';
import { embed_api_batch } from './api-adapter-batch';
import {
  load_tiktoken_tokenizer,
  prepare_request_headers,
  request_api,
  resolve_tokenizer_provider,
  trim_input_to_max_tokens,
} from './api-adapter-request';

export class EmbedModelApiAdapter {
  adapter: string;
  model_key: string;
  dims: number;
  models: Record<string, ModelInfo>;
  settings: Record<string, unknown>;
  tiktoken: { encode(text: string): number[] } | null = null;
  private _tokenizer_provider: TokenizerProvider | null = null;

  constructor(config: {
    adapter: string;
    model_key: string;
    dims: number;
    models: Record<string, ModelInfo>;
    settings: Record<string, unknown>;
  }) {
    this.adapter = config.adapter;
    this.model_key = config.model_key;
    this.dims = config.dims;
    this.models = config.models;
    this.settings = config.settings;
  }

  get tokenizer_provider(): TokenizerProvider {
    if (!this._tokenizer_provider) {
      this._tokenizer_provider = resolve_tokenizer_provider(this.models, this.model_key);
    }
    return this._tokenizer_provider;
  }

  get req_adapter(): typeof EmbedModelRequestAdapter { return EmbedModelRequestAdapter; }
  get res_adapter(): typeof EmbedModelResponseAdapter { return EmbedModelResponseAdapter; }
  get endpoint(): string | undefined { return this.models[this.model_key]?.endpoint; }
  get api_key(): string | undefined {
    return (this.settings[`${this.adapter}.api_key`] as string | undefined) || (this.settings.api_key as string | undefined);
  }
  get max_tokens(): number { return this.models[this.model_key]?.max_tokens || 8191; }
  get request_token_budget(): number {
    return Math.max(1, Math.floor(this.max_tokens * this.tokenizer_provider.safety_ratio));
  }
  get batch_size(): number { return this.models[this.model_key]?.batch_size || 1; }

  async count_tokens(input: string): Promise<number> {
    return this.tokenizer_provider.count_tokens(input);
  }

  estimate_tokens(input: string | object): number {
    if (typeof input === 'object') input = JSON.stringify(input);
    return Math.ceil(input.length / 3.7);
  }

  async embed_batch(inputs: (EmbedInput | { _embed_input: string })[]): Promise<EmbedResult[]> {
    return embed_api_batch(this, inputs);
  }

  prepare_embed_input(_embed_input: string): Promise<string | null> {
    throw new Error('prepare_embed_input not implemented');
  }

  prepare_request_headers(): Record<string, string> {
    return prepare_request_headers(this.api_key);
  }

  async request(req: Record<string, unknown>): Promise<unknown> {
    return request_api(this.endpoint!, req);
  }

  embed_query(query: string): Promise<EmbedResult[]> {
    return this.embed_batch([{ embed_input: query }]);
  }

  async test_api_key(): Promise<void> {
    const first = (await this.embed_batch([{ embed_input: 'test' }]))[0];
    if (!first?.vec) throw new Error('API key validation failed');
  }

  async trim_input_to_max_tokens(
    embed_input: string,
    tokens_ct: number,
    max_tokens_override?: number,
  ): Promise<string | null> {
    return trim_input_to_max_tokens(
      (input) => this.count_tokens(input),
      embed_input,
      tokens_ct,
      max_tokens_override || this.request_token_budget,
    );
  }

  async load_tiktoken(): Promise<void> {
    this.tiktoken = await load_tiktoken_tokenizer();
  }

  get_model_info(model_key?: string): ModelInfo | undefined {
    return this.models[model_key || this.model_key];
  }
}

export class EmbedModelRequestAdapter {
  constructor(
    public adapter: EmbedModelApiAdapter,
    public embed_inputs: string[],
  ) {}

  get model_id(): string { return this.adapter.model_key; }
  get model_dims(): number | undefined { return this.adapter.dims; }
  get_headers(): Record<string, string> { return this.adapter.prepare_request_headers(); }
  to_platform(): Record<string, unknown> {
    return {
      method: 'POST',
      headers: this.get_headers(),
      body: JSON.stringify(this.prepare_request_body()),
    };
  }

  prepare_request_body(): Record<string, unknown> {
    throw new Error('prepare_request_body not implemented');
  }
}

export class EmbedModelResponseAdapter {
  constructor(
    public adapter: EmbedModelApiAdapter,
    public response: unknown,
  ) {}

  to_openai(): EmbedResult[] {
    return this.parse_response();
  }

  parse_response(): EmbedResult[] {
    throw new Error('parse_response not implemented');
  }
}
