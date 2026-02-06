/**
 * @file create_hash.ts
 * @description Hash functions for content fingerprinting
 */

/**
 * Creates a SHA-256 hash of the given text.
 * @param text Text to hash
 * @returns SHA-256 hash as hex string
 */
export async function create_hash(text: string): Promise<string> {
  // Truncate very large text to avoid performance issues
  if (text.length > 100000) {
    text = text.substring(0, 100000);
  }

  const msgUint8 = new TextEncoder().encode(text.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

/**
 * Helper for 32-bit integer overflow multiplication
 */
function multiply_32(a: number, b: number): number {
  return ((a & 0xffff) * b + (((a >>> 16) * b) << 16)) | 0;
}

/**
 * 32-bit rotate left
 */
function rotate_left_32(value: number, shift: number): number {
  return (value << shift) | (value >>> (32 - shift));
}

/**
 * Finalize MurmurHash3
 */
function fmix_32(h: number): number {
  h ^= h >>> 16;
  h = multiply_32(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = multiply_32(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h | 0;
}

/**
 * Computes MurmurHash3 (32-bit) for a given string
 * @param input_string String to hash
 * @param seed Seed value (default 0)
 * @returns 32-bit hash as signed integer
 */
export function murmur_hash_32(input_string: string, seed: number = 0): number {
  const remainder = input_string.length & 3;
  const bytes = input_string.length - remainder;
  let h1 = seed;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
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

  // Finalization
  h1 ^= input_string.length;
  h1 = fmix_32(h1);

  return h1 | 0;
}

/**
 * Creates an alphanumeric (base 36) representation of MurmurHash3
 * @param input_string String to hash
 * @param seed Seed for the hash (default 0)
 * @returns Hash as base-36 string
 */
export function murmur_hash_32_alphanumeric(input_string: string, seed: number = 0): string {
  const signed_hash = murmur_hash_32(input_string, seed);
  const unsigned_hash = signed_hash >>> 0;
  return unsigned_hash.toString(36);
}

/**
 * Helper for FNV-1a 32-bit multiplication
 */
function fnv_multiply_32(a: number, b: number): number {
  return (a * b) >>> 0;
}

/**
 * Compute FNV-1a 32-bit hash (unsigned integer)
 * @param input_string String to hash
 * @returns 32-bit hash as unsigned integer
 */
export function fnv1a_32(input_string: string): number {
  let hash = 2166136261; // FNV offset basis
  const prime = 16777619;

  for (let i = 0; i < input_string.length; i++) {
    hash ^= input_string.charCodeAt(i);
    hash = fnv_multiply_32(hash, prime);
  }

  return hash >>> 0;
}

/**
 * Converts FNV-1a 32-bit hash to alphanumeric (base 36) representation
 * @param input_string String to hash
 * @returns Base-36 representation (~7 chars)
 */
export function fnv1a_32_alphanumeric(input_string: string): string {
  return fnv1a_32(input_string).toString(36);
}
