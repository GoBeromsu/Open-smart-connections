import type { IncomingMessage } from 'node:http';
import type { JsonRpcRequest } from '../types/mcp';

export interface HttpAuthOptions {
  token?: string;
  unsafeNoAuth?: boolean;
}

export function isHttpNoteReadRequest(request: JsonRpcRequest): boolean {
  const params = request.params;
  const name = typeof params?.name === 'string' ? params.name : '';
  return request.method === 'tools/call'
    && (name === 'get' || name === 'multi_get' || name === 'query' || name === 'connections');
}

export function isHttpRequestAuthorized(
  req: IncomingMessage,
  request: JsonRpcRequest,
  options: HttpAuthOptions,
): boolean {
  if (!isHttpNoteReadRequest(request)) return true;
  if (options.unsafeNoAuth) return true;
  if (!options.token) return false;
  return readBearerToken(req) === options.token || req.headers['x-open-connections-token'] === options.token;
}

function readBearerToken(req: IncomingMessage): string | null {
  const value = req.headers.authorization;
  if (typeof value !== 'string') return null;
  const match = /^Bearer\s+(.+)$/i.exec(value.trim());
  return match?.[1] ?? null;
}
