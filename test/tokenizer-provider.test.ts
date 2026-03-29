import { describe, expect, it } from 'vitest';
import { createTokenizerProvider } from '../src/domain/tokenizer-provider';

describe('TokenizerProvider', () => {
  it('counts tokens using chars_per_token ratio', async () => {
    const provider = createTokenizerProvider({
      type: 'char-estimate',
      chars_per_token: 2.0,
      safety_ratio: 0.75,
    });

    expect(await provider.count_tokens('a'.repeat(10000))).toBe(5000);
    expect(provider.is_exact).toBe(false);
    expect(provider.safety_ratio).toBe(0.75);
  });

  it('creates an exact provider for tiktoken configs', () => {
    const provider = createTokenizerProvider({
      type: 'tiktoken',
      model_id: 'cl100k_base',
      safety_ratio: 0.95,
    });

    expect(provider.is_exact).toBe(true);
    expect(provider.safety_ratio).toBe(0.95);
  });
});
