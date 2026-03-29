/**
 * @file sort-by-score.ts
 * @description Score comparator helpers.
 */

import type { ScoredResult } from './results-accumulator';

export function sort_by_score_descending<T>(a: ScoredResult<T>, b: ScoredResult<T>): number {
  const epsilon = 1e-9;
  const diff = a.score - b.score;
  if (Math.abs(diff) < epsilon) return 0;
  return diff > 0 ? -1 : 1;
}

export function sort_by_score_ascending<T>(a: ScoredResult<T>, b: ScoredResult<T>): number {
  return sort_by_score_descending(b, a);
}
