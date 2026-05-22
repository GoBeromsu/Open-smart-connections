import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { isHttpRequestAuthorized, isHttpNoteReadRequest } from '../src/mcp/http-auth';

function req(headers: Record<string, string | undefined>): IncomingMessage {
  return { headers } as IncomingMessage;
}

describe('MCP HTTP note-read auth', () => {
  it('identifies vault-data tool calls that require auth', () => {
    expect(isHttpNoteReadRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get' } })).toBe(true);
    expect(isHttpNoteReadRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'multi_get' } })).toBe(true);
    expect(isHttpNoteReadRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query' } })).toBe(true);
    expect(isHttpNoteReadRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'connections' } })).toBe(true);
    expect(isHttpNoteReadRequest({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'status' } })).toBe(false);
  });

  it('rejects HTTP note reads without a configured or matching token', () => {
    const request = { jsonrpc: '2.0' as const, id: 1, method: 'tools/call', params: { name: 'get' } };

    expect(isHttpRequestAuthorized(req({}), request, {})).toBe(false);
    expect(isHttpRequestAuthorized(req({ authorization: 'Bearer wrong' }), request, { token: 'secret' })).toBe(false);
  });

  it('accepts valid bearer or explicit header tokens and leaves non-vault-data tools compatible', () => {
    const get = { jsonrpc: '2.0' as const, id: 1, method: 'tools/call', params: { name: 'get' } };
    const status = { jsonrpc: '2.0' as const, id: 2, method: 'tools/call', params: { name: 'status' } };

    expect(isHttpRequestAuthorized(req({ authorization: 'Bearer secret' }), get, { token: 'secret' })).toBe(true);
    expect(isHttpRequestAuthorized(req({ 'x-open-connections-token': 'secret' }), get, { token: 'secret' })).toBe(true);
    expect(isHttpRequestAuthorized(req({}), status, {})).toBe(true);
  });

  it('requires the explicitly named unsafe opt-out for unauthenticated note reads', () => {
    const request = { jsonrpc: '2.0' as const, id: 1, method: 'tools/call', params: { name: 'multi_get' } };
    expect(isHttpRequestAuthorized(req({}), request, { unsafeNoAuth: true })).toBe(true);
  });
});
