/**
 * @file errors.ts
 * @description Typed error classes for embedding API error classification.
 *
 * TransientError: retryable (429, 5xx, network). Pipeline retries with backoff.
 * FatalError: non-retryable (4xx auth/client errors). Pipeline fails immediately.
 */

/**
 * Transient errors are retryable: 429 (rate limit), 503 (service unavailable),
 * network timeouts, connection refused, etc.
 */
export class TransientError extends Error {
  readonly status: number;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    status: number,
    opts?: { retryAfterMs?: number },
  ) {
    super(message);
    this.name = 'TransientError';
    this.status = status;
    this.retryAfterMs = opts?.retryAfterMs;
  }
}

/**
 * Fatal errors are NOT retryable: 400 (bad request), 401 (unauthorized),
 * 403 (forbidden), malformed response, etc.
 */
export class FatalError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'FatalError';
    this.status = status;
  }
}
