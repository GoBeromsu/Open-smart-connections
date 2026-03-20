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


