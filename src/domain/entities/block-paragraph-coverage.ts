/**
 * @file block-paragraph-coverage.ts
 * @description Cached paragraph coverage index for block embedding decisions.
 */

import type { BlockCollection } from './BlockCollection';
import type { EmbeddingBlock } from './EmbeddingBlock';

const coverageCache = new WeakMap<BlockCollection, Map<string, Map<string, number>>>();

function ensureSourceCache(collection: BlockCollection): Map<string, Map<string, number>> {
  let bySource = coverageCache.get(collection);
  if (!bySource) {
    bySource = new Map();
    coverageCache.set(collection, bySource);
  }
  return bySource;
}

function buildCoverageMap(blocks: EmbeddingBlock[]): Map<string, number> {
  const coverage = new Map<string, number>();

  for (const block of blocks) {
    if (!block.key.includes('#paragraph-')) continue;

    const weight = block.data.length ?? block.size ?? 0;
    let ancestor = block.key.replace(/#paragraph-[^#]+$/, '');
    while (ancestor.includes('#')) {
      coverage.set(ancestor, (coverage.get(ancestor) ?? 0) + weight);
      ancestor = ancestor.replace(/#[^#]+$/, '');
    }
  }

  return coverage;
}

export function invalidateParagraphCoverage(collection: BlockCollection, sourceKey?: string): void {
  const bySource = coverageCache.get(collection);
  if (!bySource) return;

  if (!sourceKey) {
    coverageCache.delete(collection);
    return;
  }

  bySource.delete(sourceKey);
}

export function getParagraphCoverage(
  collection: BlockCollection,
  sourceKey: string,
  blockKey: string,
): number {
  const bySource = ensureSourceCache(collection);
  let coverage = bySource.get(sourceKey);
  if (!coverage) {
    coverage = buildCoverageMap(collection.for_source(sourceKey));
    bySource.set(sourceKey, coverage);
  }
  return coverage.get(blockKey) ?? 0;
}
