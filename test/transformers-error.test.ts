/**
 * @file transformers-error.test.ts
 * @description TDD tests for model download error classification
 *
 * Covers classifyDownloadError and isRetryableDownloadError from src/domain/embed-error.ts.
 * Only 'network' errors are retryable; all other error types fail immediately.
 */

import { describe, expect, it } from 'vitest';
import { classifyDownloadError, isRetryableDownloadError } from '../src/domain/embed-error';

describe('classifyDownloadError', () => {
  it('classifies timeout errors', () => {
    expect(classifyDownloadError(new Error('Timed out waiting for iframe response'))).toBe('timeout');
    expect(classifyDownloadError(new Error('Request timeout after 180000ms'))).toBe('timeout');
    expect(classifyDownloadError('[download:timeout] Model download timed out')).toBe('timeout');
  });

  it('classifies quota errors', () => {
    expect(classifyDownloadError(new Error('QuotaExceededError'))).toBe('quota');
    expect(classifyDownloadError(new Error('storage quota exceeded'))).toBe('quota');
    expect(classifyDownloadError('[download:quota] Browser storage quota exceeded')).toBe('quota');
  });

  it('classifies network errors', () => {
    expect(classifyDownloadError(new Error('Failed to fetch'))).toBe('network');
    expect(classifyDownloadError(new Error('[download:network] CDN unavailable'))).toBe('network');
    expect(classifyDownloadError(new Error('NetworkError when attempting to fetch'))).toBe('network');
    expect(classifyDownloadError(new Error('ERR_CONNECTION_REFUSED'))).toBe('network');
    expect(classifyDownloadError(new Error('CORS error'))).toBe('network');
  });

  it('classifies model not found errors', () => {
    expect(classifyDownloadError(new Error('404 Not Found'))).toBe('model_not_found');
    expect(classifyDownloadError(new Error('Model not found on HuggingFace'))).toBe('model_not_found');
    expect(classifyDownloadError('[download:model_not_found] No such model')).toBe('model_not_found');
  });

  it('classifies unknown errors', () => {
    expect(classifyDownloadError(new Error('Something went wrong'))).toBe('unknown');
    expect(classifyDownloadError(null)).toBe('unknown');
    expect(classifyDownloadError(undefined)).toBe('unknown');
    expect(classifyDownloadError('')).toBe('unknown');
  });

  it('handles non-Error inputs', () => {
    expect(classifyDownloadError('Failed to fetch resource')).toBe('network');
    expect(classifyDownloadError(42)).toBe('unknown');
    expect(classifyDownloadError({ message: 'timeout occurred' })).toBe('unknown');
  });
});

describe('isRetryableDownloadError', () => {
  it('only network errors are retryable', () => {
    expect(isRetryableDownloadError('network')).toBe(true);
  });

  it('non-network errors are not retryable', () => {
    expect(isRetryableDownloadError('timeout')).toBe(false);
    expect(isRetryableDownloadError('quota')).toBe(false);
    expect(isRetryableDownloadError('model_not_found')).toBe(false);
    expect(isRetryableDownloadError('unknown')).toBe(false);
  });
});
