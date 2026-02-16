/**
 * @file sort_by_score.ts
 * @description Sort functions for scored results
 */

import type { ScoredResult } from './results_acc';

/**
 * Sort comparator for descending scores (highest first)
 */
export function sort_by_score<T>(a: ScoredResult<T>, b: ScoredResult<T>): number {
  const epsilon = 1e-9; // Small threshold for float comparison
  const score_diff = a.score - b.score;

  if (Math.abs(score_diff) < epsilon) return 0;
  return score_diff > 0 ? -1 : 1;
}

/**
 * Sort comparator for descending scores (alias)
 */
export function sort_by_score_descending<T>(a: ScoredResult<T>, b: ScoredResult<T>): number {
  return sort_by_score(a, b);
}

/**
 * Sort comparator for ascending scores (lowest first)
 */
export function sort_by_score_ascending<T>(a: ScoredResult<T>, b: ScoredResult<T>): number {
  return sort_by_score(a, b) * -1;
}
