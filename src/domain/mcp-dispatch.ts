import type { JsonRpcRequest, JsonRpcResponse } from '../types/mcp';
import type { McpToolResult } from '../types/mcp';
import type { McpContext } from '../types/mcp-context';
import { jsonRpcResult, jsonRpcError, toolTextResult } from './mcp-rpc';
import { toolDefinitions } from './mcp-tool-schemas';
import { queryTool, connectionsTool } from './mcp-query-tools';
import { getTool, multiGetTool, statusTool } from './mcp-note-tools';

export const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'] as const;
export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

async function handleToolCall(
  ctx: McpContext,
  endpointUrl: string,
  params: Record<string, unknown> | undefined,
): Promise<McpToolResult> {
  const name = typeof params?.name === 'string' ? params.name : '';
  const args = (params?.arguments && typeof params.arguments === 'object')
    ? params.arguments as Record<string, unknown>
    : {};

  switch (name) {
    case 'query':
      return await queryTool(ctx, args);
    case 'connections':
      return await connectionsTool(ctx, args);
    case 'get':
      return await getTool(ctx, args);
    case 'multi_get':
      return await multiGetTool(ctx, args);
    case 'status':
      return statusTool(ctx, endpointUrl);
    default:
      return toolTextResult(`Unknown tool: ${name}`, { ok: false, error: 'unknown_tool', name }, true);
  }
}

export async function dispatchMcpRequest(
  ctx: McpContext,
  request: JsonRpcRequest,
  endpointUrl: string,
): Promise<JsonRpcResponse | null> {
  const id = request.id ?? null;

  try {
    switch (request.method) {
      case 'initialize': {
        const clientVersion = typeof request.params?.protocolVersion === 'string'
          ? request.params.protocolVersion
          : undefined;
        const protocolVersion = clientVersion && SUPPORTED_PROTOCOL_VERSIONS.includes(clientVersion as typeof SUPPORTED_PROTOCOL_VERSIONS[number])
          ? clientVersion
          : LATEST_PROTOCOL_VERSION;
        return jsonRpcResult(id, {
          protocolVersion,
          serverInfo: {
            name: 'open-connections',
            version: ctx.version,
          },
          capabilities: {
            tools: {},
          },
        });
      }

      case 'notifications/initialized':
        return null;

      case 'ping':
        return jsonRpcResult(id, {});

      case 'tools/list':
        return jsonRpcResult(id, { tools: toolDefinitions() });

      case 'tools/call':
        return jsonRpcResult(id, await handleToolCall(ctx, endpointUrl, request.params));

      default:
        return jsonRpcError(id, -32601, `Method not found: ${request.method}`);
    }
  } catch (error) {
    ctx.logger.warn('[MCP] Request failed', { method: request.method, error });
    return jsonRpcError(
      id,
      -32603,
      error instanceof Error ? error.message : 'Internal error',
    );
  }
}
