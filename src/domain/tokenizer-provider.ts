/**
 * @file tokenizer-provider.ts
 * @description Tokenizer providers resolved from ModelInfo.tokenizer config.
 */

import type { TiktokenBPE } from 'js-tiktoken/lite';
import type { TokenizerConfig } from '../types/models';

export type FetchJsonFn = (url: string) => Promise<unknown>;

export interface TokenizerProvider {
  count_tokens(input: string): Promise<number>;
  readonly is_exact: boolean;
  readonly safety_ratio: number;
}

class TiktokenProvider implements TokenizerProvider {
  private instance: { encode(text: string): number[] } | null = null;
  private fallback: CharEstimateProvider;
  readonly is_exact = true;
  readonly safety_ratio: number;

  constructor(
    private readonly encoding: string,
    safety_ratio: number,
    private readonly fetchJson: FetchJsonFn,
  ) {
    this.safety_ratio = safety_ratio;
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
      `https://raw.githubusercontent.com/brianpetro/jsbrains/refs/heads/main/smart-embed-model/${this.encoding}.json`,
    );
    this.instance = new Tiktoken(bpe as TiktokenBPE);
  }
}

class CharEstimateProvider implements TokenizerProvider {
  readonly is_exact = false;
  readonly safety_ratio: number;

  constructor(
    private readonly chars_per_token = 3.7,
    safety_ratio = 0.75,
  ) {
    this.safety_ratio = safety_ratio;
  }

  count_tokens(input: string): Promise<number> {
    return Promise.resolve(Math.ceil(input.length / this.chars_per_token));
  }
}

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
