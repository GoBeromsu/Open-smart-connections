/**
 * @file embed-error.ts
 * @description Error classification for embedding model download failures
 */

export type DownloadErrorType = 'timeout' | 'quota' | 'network' | 'model_not_found' | 'unknown';

/**
 * Classify a model download error into an actionable category.
 * Pure function — no side effects.
 */
export function classifyDownloadError(error: unknown): DownloadErrorType {
  const rawMsg = error instanceof Error
    ? error.message
    : (error !== null && error !== undefined
      ? (typeof error === 'object'
        ? JSON.stringify(error as Record<string, unknown>)
        : String(error as string | number | boolean | bigint | symbol))
      : '');
  const msg = rawMsg.toLowerCase();

  if (msg.includes('timed out') || msg.includes('timeout')) return 'timeout';
  if (msg.includes('quota') || msg.includes('quotaexceeded') || msg.includes('storage')) return 'quota';
  if (msg.includes('404') || msg.includes('not found') || msg.includes('no such model')) return 'model_not_found';
  if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('cdn') || msg.includes('cors') || msg.includes('err_connection')) return 'network';
  return 'unknown';
}

/**
 * Whether this error type is worth retrying with backoff.
 */
export function isRetryableDownloadError(errorType: DownloadErrorType): boolean {
  return errorType === 'network';
}
