/**
 * @file sim_hash.ts
 * @description 32-bit SimHash for embedding vectors using MurmurHash3
 */

import { murmur_hash_32 } from './create_hash';

/**
 * SimHash options
 */
export interface SimHashOptions {
  /** Seed for MurmurHash3 (default 0) */
  seed?: number;
}

/**
 * Generate a 32-bit SimHash for an array of floats using MurmurHash3.
 * SimHash is a locality-sensitive hash that maps similar vectors to similar hashes.
 *
 * @param vector Array of floats (e.g., embedding vector)
 * @param options Options including seed
 * @returns 8-character hex string representing 32-bit hash
 */
export function sim_hash(vector: number[], options: SimHashOptions = {}): string {
  const { seed = 0 } = options;
  const BIT_LENGTH = 32;

  // Use floating accumulator array with 32 elements
  const bit_acc = new Float64Array(BIT_LENGTH);

  for (let i = 0; i < vector.length; i++) {
    const weight = vector[i];
    // Use dimension index as hash input
    const h = murmur_hash_32(i.toString(), seed);

    for (let b = 0; b < BIT_LENGTH; b++) {
      if ((h >>> b) & 1) {
        bit_acc[b] += weight;
      } else {
        bit_acc[b] -= weight;
      }
    }
  }

  // Convert sign of each accumulator to a bit
  let hash_value = 0;
  for (let b = BIT_LENGTH - 1; b >= 0; b--) {
    hash_value <<= 1;
    if (bit_acc[b] >= 0) {
      hash_value |= 1;
    }
  }

  // Return as 8-hex-digit string
  return (hash_value >>> 0).toString(16).padStart(8, '0');
}
