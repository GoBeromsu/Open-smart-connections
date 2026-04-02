import { toolTextResult } from './mcp-rpc';
import type { McpContext } from '../types/mcp-context';
import type { McpToolResult } from '../types/mcp';

interface GetArgs {
  path?: string;
}

interface MultiGetArgs {
  paths?: string[];
}

const MULTI_GET_MAX = 20;

async function readNoteTool(ctx: McpContext, path: string): Promise<McpToolResult> {
  const content = await ctx.readNote(path);
  if (content === null) {
    return toolTextResult(`Note not found: ${path}`, { ok: false, error: 'note_not_found', path }, true);
  }
  return toolTextResult(content, { ok: true, path, content });
}

export async function getTool(ctx: McpContext, args: GetArgs): Promise<McpToolResult> {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path) {
    return toolTextResult('Missing required argument: path', { ok: false, error: 'missing_path' }, true);
  }
  return await readNoteTool(ctx, path);
}

export async function multiGetTool(ctx: McpContext, args: MultiGetArgs): Promise<McpToolResult> {
  let paths = Array.isArray(args.paths)
    ? args.paths.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    : [];

  if (paths.length === 0) {
    return toolTextResult('Missing required argument: paths', { ok: false, error: 'missing_paths' }, true);
  }

  paths = paths.slice(0, MULTI_GET_MAX);

  const items = await Promise.all(paths.map(async (path) => {
    const result = await readNoteTool(ctx, path);
    return result.structuredContent ?? { ok: false, error: 'unknown_error', path };
  }));

  return toolTextResult(
    JSON.stringify({ paths, items }, null, 2),
    { ok: true, paths, items },
  );
}

export function statusTool(ctx: McpContext, endpointUrl: string): McpToolResult {
  const model = ctx.getModelInfo();
  const stats = ctx.getStats();
  const status = {
    ready: ctx.ready,
    embed_ready: ctx.embedReady,
    status_state: ctx.statusState,
    endpoint_url: endpointUrl,
    model,
    source_count: stats.sourceCount,
    embedded_source_count: stats.embeddedSourceCount,
    block_count: stats.blockCount,
    embedded_block_count: stats.embeddedBlockCount,
  };

  return toolTextResult(JSON.stringify(status, null, 2), status);
}
