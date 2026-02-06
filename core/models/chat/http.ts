/**
 * @file http.ts
 * @description HTTP utilities using Obsidian's requestUrl()
 * Replaces SmartHttpRequest from lib
 */

import { requestUrl, RequestUrlParam, RequestUrlResponse } from 'obsidian';

export interface HttpRequestParams {
  url: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  contentType?: string;
}

/**
 * Make an HTTP request using Obsidian's requestUrl()
 */
export async function http_request(params: HttpRequestParams): Promise<RequestUrlResponse> {
  const request_params: RequestUrlParam = {
    url: params.url,
    method: params.method,
    headers: params.headers || {},
    body: params.body,
    contentType: params.contentType || 'application/json',
    throw: false, // Don't throw on HTTP errors, we'll handle them
  };

  try {
    const response = await requestUrl(request_params);
    return response;
  } catch (error) {
    console.error('HTTP request failed:', error);
    throw error;
  }
}

/**
 * Parse JSON response safely
 */
export function parse_json_response(response: RequestUrlResponse): any {
  try {
    if (typeof response.json === 'object') {
      return response.json;
    }
    return JSON.parse(response.text);
  } catch (error) {
    console.error('Failed to parse JSON response:', error);
    throw new Error(`Invalid JSON response: ${response.text.substring(0, 100)}`);
  }
}

/**
 * Normalize error from HTTP response or exception
 */
export function normalize_http_error(error: any): Error {
  if (error instanceof Error) {
    return error;
  }
  if (typeof error === 'string') {
    return new Error(error);
  }
  if (error?.message) {
    return new Error(error.message);
  }
  if (error?.error) {
    return normalize_http_error(error.error);
  }
  return new Error(JSON.stringify(error));
}
