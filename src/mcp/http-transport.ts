/**
 * @file http-transport.ts
 * @description HTTP JSON-RPC transport for the standalone MCP server.
 *
 * Listens on the given port and dispatches POST requests containing a
 * JSON-RPC body through the MCP handler. Supports CORS for local clients.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';

import type { McpContext } from '../types/mcp-context';
import type { JsonRpcRequest } from '../types/mcp';
import { dispatchMcpRequest } from './dispatch';
import { isHttpRequestAuthorized, type HttpAuthOptions } from './http-auth';

export function startHttpTransport(
  ctx: McpContext,
  port: number,
  auth: HttpAuthOptions = {},
): void {
  const server = createServer((req, res) => {
    void handleRequest(req, res, ctx, port, auth);
  });

  server.listen(port, '127.0.0.1', () => {
    console.error(`[open-connections] MCP HTTP server listening on http://127.0.0.1:${port}`);
  });
}

async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: McpContext,
  port: number,
  auth: HttpAuthOptions,
): Promise<void> {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Open-Connections-Token');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  try {
    const body = await readBody(req);
    const request = JSON.parse(body) as JsonRpcRequest;
    if (!isHttpRequestAuthorized(req, request, auth)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: { code: -32001, message: 'Unauthorized note read' },
      }));
      return;
    }
    const endpointUrl = `http://127.0.0.1:${port}`;
    const response = await dispatchMcpRequest(ctx, request, endpointUrl);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(response ? JSON.stringify(response) : '');
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message },
    }));
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
