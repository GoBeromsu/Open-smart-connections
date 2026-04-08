/**
 * @file query-tools.ts
 * @description MCP query/connections tool implementations.
 */

import { toolTextResult, clampLimit } from './rpc';
import type { McpContext, McpSearchResult } from '../types/mcp-context';
import type { McpToolResult } from '../types/mcp';

interface QueryArgs {
  query?: string;
  limit?: number;
  scope?: string;
}

interface ConnectionsArgs {
  path?: string;
  limit?: number;
}

function toMatchRecord(r: McpSearchResult): Record<string, unknown> {
  return {
    path: r.path,
    score: r.score,
    block_key: r.blockKey,
    headings: r.headings,
    preview: r.preview,
  };
}

export async function queryTool(ctx: McpContext, args: QueryArgs): Promise<McpToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) {
    return toolTextResult('Missing required argument: query', { ok: false, error: 'missing_query' }, true);
  }

  if (!ctx.ready) {
    return toolTextResult('Open Connections is still initializing.', { ok: false, error: 'plugin_not_ready' }, true);
  }

  if (!ctx.embedReady) {
    const message = ctx.statusState === 'error'
      ? 'Embedding model is unavailable. Check Open Connections settings and runtime errors.'
      : 'Embedding model is still loading.';
    return toolTextResult(message, { ok: false, error: 'embed_model_unavailable' }, true);
  }

  const scope = args.scope === 'blocks' ? 'blocks' : 'all';
  const limit = clampLimit(args.limit);
  const queryVector = await ctx.embedQuery(query);

  if (scope === 'blocks') {
    const results = await ctx.searchNearest(queryVector, { limit });
    const matches = results.map(toMatchRecord);
    return toolTextResult(
      JSON.stringify({ query, scope, matches }, null, 2),
      { ok: true, query, scope, matches },
    );
  }

  const results = await ctx.searchNearest(queryVector, { limit });
  const matches = results.map(toMatchRecord);
  return toolTextResult(
    JSON.stringify({ query, scope, matches }, null, 2),
    { ok: true, query, scope, matches },
  );
}

export async function connectionsTool(ctx: McpContext, args: ConnectionsArgs): Promise<McpToolResult> {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  if (!path) {
    return toolTextResult('Missing required argument: path', { ok: false, error: 'missing_path' }, true);
  }

  if (!ctx.ready) {
    return toolTextResult('Open Connections is still initializing.', { ok: false, error: 'plugin_not_ready' }, true);
  }

  const results = await ctx.getConnections(path, clampLimit(args.limit));
  const matches = results.map(toMatchRecord);

  return toolTextResult(
    JSON.stringify({ path, matches }, null, 2),
    { ok: true, path, matches },
  );
}
