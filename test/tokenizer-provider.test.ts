import { describe, it, expect } from 'vitest';
import { createTokenizerProvider } from '../src/domain/tokenizer-provider';

describe('TokenizerProvider', () => {
  describe('CharEstimateProvider', () => {
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

    it('uses default values when not specified', async () => {
      const provider = createTokenizerProvider({ type: 'char-estimate' });
      expect(await provider.count_tokens('a'.repeat(37))).toBe(10); // ceil(37/3.7)
      expect(provider.safety_ratio).toBe(0.75);
    });
  });

  describe('createTokenizerProvider', () => {
    it('creates CharEstimateProvider for char-estimate type', () => {
      const provider = createTokenizerProvider({
        type: 'char-estimate',
        chars_per_token: 2.5,
        safety_ratio: 0.8,
      });
      expect(provider.is_exact).toBe(false);
      expect(provider.safety_ratio).toBe(0.8);
    });

    it('creates TiktokenProvider for tiktoken type', () => {
      const provider = createTokenizerProvider({
        type: 'tiktoken',
        model_id: 'cl100k_base',
        safety_ratio: 0.95,
      });
      expect(provider.is_exact).toBe(true);
      expect(provider.safety_ratio).toBe(0.95);
    });

    it('falls back to CharEstimateProvider for unknown type', () => {
      const provider = createTokenizerProvider({ type: 'unknown' as any });
      expect(provider.is_exact).toBe(false);
    });
  });
});
