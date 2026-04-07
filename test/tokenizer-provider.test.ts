import { describe, expect, it } from 'vitest';
import { createTokenizerProvider } from '../src/domain/tokenizer-provider';
import { resolve_tokenizer_provider } from '../src/ui/embed-adapters/api-adapter-request';

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

  it('resolves tokenizer behavior from the selected model config rather than adapter assumptions', async () => {
    const models = {
      compact: {
        tokenizer: {
          type: 'char-estimate' as const,
          chars_per_token: 2,
          safety_ratio: 0.6,
        },
      },
      roomy: {
        tokenizer: {
          type: 'char-estimate' as const,
          chars_per_token: 5,
          safety_ratio: 0.9,
        },
      },
    };

    const compactProvider = resolve_tokenizer_provider(models as any, 'compact');
    const roomyProvider = resolve_tokenizer_provider(models as any, 'roomy');

    expect(await compactProvider.count_tokens('abcdefghij')).toBe(5);
    expect(await roomyProvider.count_tokens('abcdefghij')).toBe(2);
    expect(compactProvider.safety_ratio).toBe(0.6);
    expect(roomyProvider.safety_ratio).toBe(0.9);
  });

  it('falls back to the default char-estimate tokenizer when model metadata omits tokenizer info', async () => {
    const provider = resolve_tokenizer_provider({ custom: {} as any }, 'custom');

    expect(await provider.count_tokens('a'.repeat(37))).toBe(10);
    expect(provider.is_exact).toBe(false);
    expect(provider.safety_ratio).toBe(0.75);
  });
});
