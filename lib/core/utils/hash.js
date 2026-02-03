/**
 * @file hash.js - Hash utility functions
 */

/**
 * Creates a SHA-256 hash of the given text.
 * @param {string} text - The text to hash.
 * @returns {Promise<string>} The SHA-256 hash of the text.
 */
export async function create_hash(text) {
  if (text.length > 100000) text = text.substring(0, 100000);
  const msgUint8 = new TextEncoder().encode(text.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

/**
 * Computes MurmurHash3 (32-bit) for a given string with an optional seed.
 * @param {string} input_string - The string to hash.
 * @param {number} [seed=0] - The seed value.
 * @returns {number} - The 32-bit hash as a signed integer.
 */
export function murmur_hash_32(input_string, seed = 0) {
  let remainder = input_string.length & 3;
  let bytes = input_string.length - remainder;
  let h1 = seed;
  let c1 = 0xcc9e2d51;
  let c2 = 0x1b873593;
  let i = 0;
  let k1 = 0;
  let chunk = 0;

  while (i < bytes) {
    chunk =
      (input_string.charCodeAt(i) & 0xff) |
      ((input_string.charCodeAt(i + 1) & 0xff) << 8) |
      ((input_string.charCodeAt(i + 2) & 0xff) << 16) |
      ((input_string.charCodeAt(i + 3) & 0xff) << 24);
    i += 4;
    k1 = chunk;
    k1 = multiply_32(k1, c1);
    k1 = rotate_left_32(k1, 15);
    k1 = multiply_32(k1, c2);
    h1 ^= k1;
    h1 = rotate_left_32(h1, 13);
    h1 = (h1 * 5 + 0xe6546b64) | 0;
  }

  k1 = 0;
  switch (remainder) {
    case 3:
      k1 ^= (input_string.charCodeAt(i + 2) & 0xff) << 16;
    case 2:
      k1 ^= (input_string.charCodeAt(i + 1) & 0xff) << 8;
    case 1:
      k1 ^= (input_string.charCodeAt(i) & 0xff);
      k1 = multiply_32(k1, c1);
      k1 = rotate_left_32(k1, 15);
      k1 = multiply_32(k1, c2);
      h1 ^= k1;
      break;
  }

  h1 ^= input_string.length;
  h1 = fmix_32(h1);
  return h1 | 0;
}

/**
 * Creates an alphanumeric (base 36) representation of the 32-bit MurmurHash3 result.
 * @param {string} input_string - The string to hash.
 * @param {number} [seed=0] - The seed for the hash.
 * @returns {string} - The hash converted to base 36.
 */
export function murmur_hash_32_alphanumeric(input_string, seed = 0) {
  const signed_hash = murmur_hash_32(input_string, seed);
  const unsigned_hash = signed_hash >>> 0;
  return unsigned_hash.toString(36);
}

function multiply_32(a, b) {
  return ((a & 0xffff) * b + (((a >>> 16) * b) << 16)) | 0;
}

function rotate_left_32(value, shift) {
  return (value << shift) | (value >>> (32 - shift));
}

function fmix_32(h) {
  h ^= h >>> 16;
  h = multiply_32(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = multiply_32(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}

/**
 * Compute FNV-1a 32-bit hash (unsigned integer).
 * @param {string} input_string - The string to hash.
 * @returns {number} - The 32-bit hash as an unsigned integer.
 */
export function fnv1a_32(input_string) {
  let hash = 2166136261;
  const prime = 16777619;
  for (let i = 0; i < input_string.length; i++) {
    hash ^= input_string.charCodeAt(i);
    hash = fnv_multiply_32(hash, prime);
  }
  return hash >>> 0;
}

/**
 * Converts FNV-1a 32-bit hash to alphanumeric (base 36) representation.
 * @param {string} input_string - The string to hash.
 * @returns {string} - Base-36 representation.
 */
export function fnv1a_32_alphanumeric(input_string) {
  return fnv1a_32(input_string).toString(36);
}

function fnv_multiply_32(a, b) {
  return (a * b) >>> 0;
}

/**
 * Generate a 32-bit SimHash for an array of floats using MurmurHash3.
 * @param {number[]} vector - Array of floats.
 * @param {Object} [options]
 * @param {number} [options.seed=0] - Seed for Murmur3 hash function.
 * @returns {string} - 8-char hex string representing a 32-bit hash.
 */
export function sim_hash(vector, { seed = 0 } = {}) {
  const BIT_LENGTH = 32;
  const bit_acc = new Float64Array(BIT_LENGTH);

  for (let i = 0; i < vector.length; i++) {
    const weight = vector[i];
    const h = murmur_hash_32(i.toString(), seed);
    for (let b = 0; b < BIT_LENGTH; b++) {
      if ((h >>> b) & 1) {
        bit_acc[b] += weight;
      } else {
        bit_acc[b] -= weight;
      }
    }
  }

  let hash_value = 0;
  for (let b = BIT_LENGTH - 1; b >= 0; b--) {
    hash_value <<= 1;
    if (bit_acc[b] >= 0) {
      hash_value |= 1;
    }
  }

  return (hash_value >>> 0).toString(16).padStart(8, '0');
}
