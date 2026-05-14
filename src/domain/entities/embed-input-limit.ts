export const DEFAULT_EMBED_INPUT_MAX_CHARS = Math.floor(500 * 3.7);

export function truncateEmbedInput(input: string): string {
  return input.substring(0, DEFAULT_EMBED_INPUT_MAX_CHARS);
}
