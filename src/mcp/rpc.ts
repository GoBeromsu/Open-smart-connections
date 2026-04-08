/**
 * @file rpc.ts
 * @description JSON-RPC response/result helpers for MCP handlers.
 */

import type { JsonRpcResponse, McpToolResult } from '../types/mcp';

export function jsonRpcResult(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

export function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message, data } };
}

export function toolTextResult(text: string, structuredContent?: Record<string, unknown>, isError = false): McpToolResult {
  return {
    content: [{ type: 'text', text }],
    structuredContent,
    isError,
  };
}

export function clampLimit(value: unknown, fallback = 10, max = 50): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.round(parsed)));
}
