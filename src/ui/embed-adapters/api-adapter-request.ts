import { requestUrl } from 'obsidian';
import { Tiktoken } from 'js-tiktoken/lite';
import type { TiktokenBPE } from 'js-tiktoken/lite';

import { FatalError, TransientError } from '../../domain/config';
import { createTokenizerProvider, type TokenizerProvider } from '../../domain/tokenizer-provider';
import type { ModelInfo } from '../../types/models';

export function resolve_tokenizer_provider(
  models: Record<string, ModelInfo>,
  model_key: string,
): TokenizerProvider {
  const model = models[model_key];
  const config = model?.tokenizer ?? { type: 'char-estimate' as const };
  return createTokenizerProvider(config, async (url: string): Promise<unknown> => {
    const response = await requestUrl(url);
    return response.json as unknown;
  });
}

export function prepare_request_headers(api_key?: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${api_key}`,
  };
}

export async function request_api(
  endpoint: string,
  req: Record<string, unknown>,
): Promise<unknown> {
  try {
    const resp = await requestUrl({
      url: endpoint,
      method: (req.method as string) || 'POST',
      headers: req.headers as Record<string, string>,
      body: req.body as string,
      throw: false,
    });

    if (resp.status >= 400) {
      const message = resp.text || 'Request failed';
      if (resp.status === 429 || resp.status >= 500) {
        throw new TransientError(message, resp.status);
      }
      throw new FatalError(message, resp.status);
    }

    return resp.json;
  } catch (error: unknown) {
    if (error instanceof TransientError || error instanceof FatalError) {
      throw error;
    }
    throw new TransientError(error instanceof Error ? error.message : 'Network error', 0);
  }
}

export async function trim_input_to_max_tokens(
  count_tokens: (input: string) => Promise<number>,
  embed_input: string,
  tokens_ct: number,
  max_tokens: number,
): Promise<string | null> {
  let trimmed = embed_input;
  let current_tokens = tokens_ct;

  for (let i = 0; i < 5 && current_tokens > max_tokens; i++) {
    const reduce_ratio = (current_tokens - max_tokens) / current_tokens;
    const aggressive_ratio = Math.min(reduce_ratio + 0.10, 0.5);
    trimmed = trimmed.slice(0, Math.floor(trimmed.length * (1 - aggressive_ratio)));

    const last_space = trimmed.lastIndexOf(' ');
    if (last_space > 0) trimmed = trimmed.slice(0, last_space);
    if (trimmed.length === 0) return null;
    current_tokens = await count_tokens(trimmed);
  }

  return current_tokens <= max_tokens ? trimmed : null;
}

export async function load_tiktoken_tokenizer(): Promise<{ encode(text: string): number[] }> {
  const response = await requestUrl(
    'https://raw.githubusercontent.com/brianpetro/jsbrains/refs/heads/main/smart-embed-model/cl100k_base.json',
  );
  return new Tiktoken(response.json as TiktokenBPE);
}
