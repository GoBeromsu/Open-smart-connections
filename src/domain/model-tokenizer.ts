import type { ModelInfo, TokenizerConfig } from '../types/models';
import { createTokenizerProvider, type TokenizerProvider } from './tokenizer-provider';

const DEFAULT_TOKENIZER_CONFIG: TokenizerConfig = { type: 'char-estimate' };

export function resolveModelTokenizerConfig(
  models: Record<string, ModelInfo>,
  modelKey: string,
): TokenizerConfig {
  return models[modelKey]?.tokenizer ?? DEFAULT_TOKENIZER_CONFIG;
}

export function createModelTokenizerProvider(
  models: Record<string, ModelInfo>,
  modelKey: string,
  loadJson: (url: string) => Promise<unknown>,
): TokenizerProvider {
  return createTokenizerProvider(resolveModelTokenizerConfig(models, modelKey), loadJson);
}
