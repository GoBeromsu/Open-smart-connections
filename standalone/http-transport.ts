/**
 * @file http-transport.ts
 * @description HTTP JSON-RPC transport for the standalone MCP server.
 *
 * Listens on the given port and dispatches POST requests containing a
 * JSON-RPC body through the MCP handler. Supports CORS for local clients.
 */

import { createServer } from 'node:http';

import type { McpContext } from '../src/types/mcp-context';
import type { JsonRpcRequest } from '../src/types/mcp';
import { dispatchMcpRequest } from '../src/domain/mcp-dispatch';

export function startHttpTransport(ctx: McpContext, port: number): void {
  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

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
      const endpointUrl = `http://localhost:${port}`;
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
  });

  server.listen(port, () => {
    console.error(`[open-connections] MCP HTTP server listening on http://localhost:${port}`);
  });
}

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
