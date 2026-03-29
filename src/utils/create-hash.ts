/**
 * @file create-hash.ts
 * @description SHA-256 content hashing helper.
 */

const encoder = new TextEncoder();

export async function create_hash(text: string): Promise<string> {
  if (text.length > 100000) {
    text = text.substring(0, 100000);
  }

  const bytes = encoder.encode(text.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
