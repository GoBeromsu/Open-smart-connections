/**
 * @file tokenizer-provider.ts
 * @description Tokenizer providers resolved from ModelInfo.tokenizer config.
 * Lazy-loaded: actual tokenizer assets fetched on first count_tokens() call.
 */

import type { TiktokenBPE } from 'js-tiktoken/lite';
import type { TokenizerConfig } from '../types/models';

/** Function that fetches a URL and returns JSON. Injected from the UI layer. */
export type FetchJsonFn = (url: string) => Promise<unknown>;

/**
 * Resolved tokenizer instance. Created from TokenizerConfig.
 */
export interface TokenizerProvider {
  count_tokens(input: string): Promise<number>;
  readonly is_exact: boolean;
  readonly safety_ratio: number;
}

class TiktokenProvider implements TokenizerProvider {
  private encoding: string;
  private instance: { encode(text: string): number[] } | null = null;
  private fallback: CharEstimateProvider;
  private fetchJson: FetchJsonFn;
  readonly is_exact = true;
  readonly safety_ratio: number;

  constructor(encoding: string, safety_ratio: number, fetchJson: FetchJsonFn) {
    this.encoding = encoding;
    this.safety_ratio = safety_ratio;
    this.fetchJson = fetchJson;
    this.fallback = new CharEstimateProvider(3.7, safety_ratio);
  }

  async count_tokens(input: string): Promise<number> {
    try {
      if (!this.instance) await this.load();
      return this.instance!.encode(input).length;
    } catch {
      return this.fallback.count_tokens(input);
    }
  }

  private async load(): Promise<void> {
    const { Tiktoken } = await import('js-tiktoken/lite');
    const bpe = await this.fetchJson(
      'https://raw.githubusercontent.com/brianpetro/jsbrains/refs/heads/main/smart-embed-model/cl100k_base.json',
    );
    this.instance = new Tiktoken(bpe as TiktokenBPE);
  }
}

class CharEstimateProvider implements TokenizerProvider {
  private chars_per_token: number;
  readonly is_exact = false;
  readonly safety_ratio: number;

  constructor(chars_per_token = 3.7, safety_ratio = 0.75) {
    this.chars_per_token = chars_per_token;
    this.safety_ratio = safety_ratio;
  }

  count_tokens(input: string): Promise<number> {
    if (typeof input === 'object') input = JSON.stringify(input);
    return Promise.resolve(Math.ceil(input.length / this.chars_per_token));
  }
}

/**
 * Factory: TokenizerConfig → TokenizerProvider
 * @param fetchJson - injected from the UI layer (e.g., obsidian requestUrl wrapper)
 */
export function createTokenizerProvider(config: TokenizerConfig, fetchJson?: FetchJsonFn): TokenizerProvider {
  switch (config.type) {
    case 'tiktoken':
      return new TiktokenProvider(
        config.model_id ?? 'cl100k_base',
        config.safety_ratio ?? 0.95,
        fetchJson ?? (() => Promise.resolve({})),
      );
    case 'char-estimate':
      return new CharEstimateProvider(
        config.chars_per_token ?? 3.7,
        config.safety_ratio ?? 0.75,
      );
    default:
      return new CharEstimateProvider(
        config.chars_per_token ?? 3.7,
        config.safety_ratio ?? 0.85,
      );
  }
}
