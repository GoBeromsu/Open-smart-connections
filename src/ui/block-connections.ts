/**
 * @file block-connections.ts
 * @description Shared helper: average block vectors → nearest search → dedupe by source path.
 * Used by ConnectionsView, commands.ts, and main.ts markdown code block processor.
 */

import type { BlockCollection } from '../domain/entities';
import type { EmbeddingBlock } from '../domain/entities/EmbeddingBlock';
import type { ConnectionResult } from '../types/entities';
import { average_vectors } from '../utils';

const EMBED_TIMEOUT_MS = 10_000;

interface CachedResult {
  results: ConnectionResult[];
  ts: number;
}
const _cache = new Map<string, CachedResult>();
const CACHE_MAX_SIZE = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateConnectionsCache(path?: string): void {
  if (path) {
    _cache.delete(path);
  } else {
    _cache.clear();
  }
}

/**
 * Find connections for a file using its embedded blocks.
 *
 * 1. Average the vectors of all embedded blocks for `filePath`.
 * 2. Search for nearest neighbours, excluding all blocks that belong to `filePath`.
 * 3. Dedupe by source path, keeping the highest-scoring block per file.
 * 4. Return results sorted descending by score, capped at `limit`.
 */
export async function getBlockConnections(
  blockCollection: BlockCollection,
  filePath: string,
  opts?: { limit?: number },
): Promise<ConnectionResult[]> {
  const limit = opts?.limit ?? 50;

  const cached = _cache.get(filePath);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.results;
  }

  const fileBlocks = blockCollection.for_source(filePath);
  const embedded = fileBlocks.filter(b => b.has_embed());
  if (embedded.length === 0) return [];

  const excludeKeys = fileBlocks.map(b => b.key);
  let timedOut = false;
  let timeoutId: number | undefined;
  const mainPromise = (async (): Promise<ConnectionResult[]> => {
    await Promise.all(embedded.map(b => blockCollection.ensure_entity_vector(b)));
    const withVec = embedded.filter(b => b.vec && b.vec.length > 0);
    if (withVec.length === 0) return [];
    const avgVec = average_vectors(withVec.map(b => b.vec!));
    withVec.forEach(b => b.evictVec());
    const raw = await blockCollection.nearest(avgVec, { limit: limit * 3, exclude: excludeKeys });
    for (const r of raw) (r.item as EmbeddingBlock).evictVec?.();
    return raw;
  })();
  const timeoutPromise = new Promise<ConnectionResult[]>(resolve => {
    timeoutId = window.setTimeout(() => { timedOut = true; resolve([]); }, EMBED_TIMEOUT_MS);
  });
  const results = await Promise.race([mainPromise, timeoutPromise]);
  if (timeoutId !== undefined) window.clearTimeout(timeoutId);
  if (timedOut) {
    // Cleanup: evict vectors loaded by the abandoned promise when it eventually resolves
    mainPromise.then(abandoned => {
      for (const r of abandoned) (r.item as EmbeddingBlock).evictVec?.();
    }).catch(() => {});
    // Timeout exceeded — return empty results; view will retry on next render
    console.warn('[SC] getBlockConnections timed out', filePath);
    return [];
  }

  // Dedupe by source path, keep highest score
  const seen = new Map<string, ConnectionResult>();
  for (const r of results) {
    const sourcePath = (r.item as EmbeddingBlock).source_key ?? r.item.key.split('#')[0];
    if (!sourcePath || sourcePath === filePath) continue;
    const existing = seen.get(sourcePath);
    if (!existing || (r.score ?? 0) > (existing.score ?? 0)) {
      seen.set(sourcePath, r);
    }
  }

  const finalResults = [...seen.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);

  if (_cache.size >= CACHE_MAX_SIZE) {
    const firstKey = _cache.keys().next().value;
    if (firstKey !== undefined) _cache.delete(firstKey);
  }
  _cache.set(filePath, { results: finalResults, ts: Date.now() });

  return finalResults;
}
