import { average_vectors } from '../utils';
import type { ConnectionResult, SearchFilter } from '../types/entities';
import type { EmbedModelAdapter } from '../types/models';
import type { BlockCollection } from './entities';
import type { EmbeddingBlock } from './entities/EmbeddingBlock';

interface SearchableCollection {
  all: unknown[];
  nearest: (vec: number[] | Float32Array, filter: SearchFilter) => Promise<ConnectionResult[]>;
}

export async function searchSemanticCollections(args: {
  query: string;
  searchAdapter: Pick<EmbedModelAdapter, 'embed_batch' | 'embed_query'>;
  collections: SearchableCollection[];
  limit?: number;
}): Promise<ConnectionResult[]> {
  const { query, searchAdapter, collections, limit = 20 } = args;
  const embedResults = typeof searchAdapter.embed_query === 'function'
    ? await searchAdapter.embed_query(query)
    : await searchAdapter.embed_batch([{ _embed_input: query }]);
  const queryVec = embedResults?.[0]?.vec;
  if (!queryVec || queryVec.length === 0) {
    throw new Error('Failed to embed search query.');
  }
  return await mergeNearestResults(queryVec, collections, limit);
}

export async function mergeNearestResults(
  queryVec: number[] | Float32Array,
  collections: SearchableCollection[],
  limit: number = 20,
): Promise<ConnectionResult[]> {
  if (collections.length === 0) return [];

  const filter: SearchFilter = { limit };
  const perCollection = await Promise.all(
    collections.map(async (collection) => {
      try {
        return await collection.nearest(queryVec, filter);
      } catch {
        return [];
      }
    }),
  );

  const merged = perCollection.flat();
  merged.sort((a, b) => b.score - a.score);

  const unique: ConnectionResult[] = [];
  const seen = new Set<string>();
  for (const result of merged) {
    if (!result?.item?.key) continue;
    if (seen.has(result.item.key)) continue;
    seen.add(result.item.key);
    unique.push(result);
    if (unique.length >= limit) break;
  }

  return unique;
}

export async function searchNearestAcrossCollections(
  collections: SearchableCollection[],
  queryVec: number[] | Float32Array,
  limit: number = 20,
): Promise<ConnectionResult[]> {
  return await mergeNearestResults(queryVec, collections, limit);
}

export async function getSourceConnections(
  blockCollection: BlockCollection,
  filePath: string,
  limit: number = 50,
): Promise<ConnectionResult[]> {
  const fileBlocks = blockCollection.for_source(filePath);
  const embedded = fileBlocks.filter((block) => block.has_embed());
  if (embedded.length === 0) return [];

  const excludeKeys = fileBlocks.map((block) => block.key);
  await Promise.all(embedded.map((block) => blockCollection.ensure_entity_vector(block)));
  await new Promise<void>((resolve) => queueMicrotask(() => resolve()));

  const withVec = embedded.filter((block) => block.vec && block.vec.length > 0);
  if (withVec.length === 0) return [];

  const avgVec = average_vectors(withVec.map((block) => block.vec!));
  withVec.forEach((block) => block.evictVec());

  const raw = await blockCollection.nearest(avgVec, { limit: limit * 3, exclude: excludeKeys });
  for (const result of raw) {
    (result.item as EmbeddingBlock).evictVec?.();
  }

  const seen = new Map<string, ConnectionResult>();
  for (const result of raw) {
    const block = result.item as EmbeddingBlock;
    const sourcePath = block.source_key ?? block.key.split('#')[0];
    if (!sourcePath || sourcePath === filePath) continue;
    const existing = seen.get(sourcePath);
    if (!existing || (result.score ?? 0) > (existing.score ?? 0)) {
      seen.set(sourcePath, result);
    }
  }

  return [...seen.values()]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}
