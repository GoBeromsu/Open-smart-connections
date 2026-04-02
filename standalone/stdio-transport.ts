/**
 * @file stdio-transport.ts
 * @description Line-delimited JSON-RPC transport over stdin/stdout.
 *
 * Reads one JSON object per line from stdin, dispatches through the MCP
 * handler, and writes the JSON response (if any) as a single line to stdout.
 */

import { createInterface } from 'node:readline';

import type { McpContext } from '../src/types/mcp-context';
import type { JsonRpcRequest } from '../src/types/mcp';
import { dispatchMcpRequest } from '../src/domain/mcp-dispatch';

export function startStdioTransport(ctx: McpContext): void {
  const rl = createInterface({ input: process.stdin, terminal: false });

  rl.on('line', async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let request: JsonRpcRequest;
    try {
      request = JSON.parse(trimmed) as JsonRpcRequest;
    } catch {
      const error = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
      process.stdout.write(JSON.stringify(error) + '\n');
      return;
    }

    try {
      const response = await dispatchMcpRequest(ctx, request, 'stdio');
      if (response) {
        process.stdout.write(JSON.stringify(response) + '\n');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Internal error';
      const error = {
        jsonrpc: '2.0',
        id: request.id ?? null,
        error: { code: -32603, message },
      };
      process.stdout.write(JSON.stringify(error) + '\n');
    }
  });

  rl.on('close', () => {
    process.exit(0);
  });
}
