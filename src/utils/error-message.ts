/**
 * @file error-message.ts
 * @description Error-to-string conversion helper.
 */

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
