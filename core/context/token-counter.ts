/**
 * @file token-counter.ts
 * @description Token counting utility using js-tiktoken
 * Lazy-loads encoder and caches instance for performance
 */

import type { Tiktoken } from 'js-tiktoken';

/**
 * Cached tiktoken encoder instance
 */
let encoder: Tiktoken | null = null;

/**
 * Count tokens in text using cl100k_base encoding (GPT-4, GPT-3.5-turbo)
 *
 * @param text Text to count tokens for
 * @returns Token count
 */
export async function countTokens(text: string): Promise<number> {
  if (!text || text.length === 0) {
    return 0;
  }

  // Lazy-load encoder on first use
  if (!encoder) {
    try {
      const { getEncoding } = await import('js-tiktoken');
      encoder = getEncoding('cl100k_base');
    } catch (error) {
      console.error('Failed to load tiktoken encoder:', error);
      // Fallback: rough approximation (1 token ≈ 4 chars)
      return Math.ceil(text.length / 4);
    }
  }

  try {
    const tokens = encoder.encode(text);
    return tokens.length;
  } catch (error) {
    console.error('Failed to count tokens:', error);
    // Fallback approximation
    return Math.ceil(text.length / 4);
  }
}

/**
 * Reset the encoder instance (for cleanup)
 */
export function freeEncoder(): void {
  encoder = null;
}
