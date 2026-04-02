/**
 * @file block-connections.ts
 * @description Cache + timeout wrapper around getSourceConnections.
 */

import type { BlockCollection } from './entities';
import type { EmbeddingBlock } from './entities/EmbeddingBlock';
import type { ConnectionResult } from '../types/entities';
import { getSourceConnections } from './semantic-search';

const EMBED_TIMEOUT_MS = 30_000;

interface CachedResult {
  results: ConnectionResult[];
  ts: number;
}
const cache = new Map<string, CachedResult>();
const CACHE_MAX_SIZE = 20;
const CACHE_TTL_MS = 5 * 60 * 1000;

export function invalidateConnectionsCache(path?: string): void {
  if (path) {
    cache.delete(path);
  } else {
    cache.clear();
  }
}

export async function getBlockConnections(
  blockCollection: BlockCollection,
  filePath: string,
  opts?: { limit?: number; logger?: { warn(msg: string, extra?: unknown): void } },
): Promise<ConnectionResult[]> {
  const limit = opts?.limit ?? 50;

  const cached = cache.get(filePath);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.results;
  }

  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const mainPromise = getSourceConnections(blockCollection, filePath, limit);

  const timeoutPromise = new Promise<ConnectionResult[]>(resolve => {
    timeoutId = setTimeout(() => {
      timedOut = true;
      resolve([]);
    }, EMBED_TIMEOUT_MS);
  });

  const results = await Promise.race([mainPromise, timeoutPromise]);
  if (timeoutId !== undefined) clearTimeout(timeoutId);

  if (timedOut) {
    mainPromise.then(abandoned => {
      for (const result of abandoned) (result.item as EmbeddingBlock).evictVec?.();
    }).catch(() => {});
    if (opts?.logger) {
      opts.logger.warn('[SC] getBlockConnections timed out', filePath);
    } else {
      console.warn('[SC] getBlockConnections timed out', filePath);
    }
    cache.delete(filePath);
    return [];
  }

  if (cache.size >= CACHE_MAX_SIZE) {
    const firstKey: string | undefined = cache.keys().next().value as string | undefined;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(filePath, { results, ts: Date.now() });

  return results;
}
