/**
 * @file results_acc.ts
 * @description Accumulate top-k results efficiently using a min/max heap approach
 */

/**
 * Result item with score
 */
export interface ScoredResult<T = any> {
  item: T;
  score: number;
}

/**
 * Accumulator for top-k highest scores
 */
export interface ResultsAccumulator<T = any> {
  results: Set<ScoredResult<T>>;
  min: number;
  minResult: ScoredResult<T> | null;
}

/**
 * Accumulator for top-k lowest scores
 */
export interface FurthestAccumulator<T = any> {
  results: Set<ScoredResult<T>>;
  max: number;
  maxResult: ScoredResult<T> | null;
}

/**
 * Find the item with smallest score in results set
 */
function find_min<T>(results: Set<ScoredResult<T>>): { minScore: number; minObj: ScoredResult<T> | null } {
  let minScore = Number.POSITIVE_INFINITY;
  let minObj: ScoredResult<T> | null = null;

  const resultsArray = Array.from(results);
  for (const obj of resultsArray) {
    if (obj.score < minScore) {
      minScore = obj.score;
      minObj = obj;
    }
  }

  return { minScore, minObj };
}

/**
 * Find the item with largest score in results set
 */
function find_max<T>(results: Set<ScoredResult<T>>): { maxScore: number; maxObj: ScoredResult<T> | null } {
  let maxScore = Number.NEGATIVE_INFINITY;
  let maxObj: ScoredResult<T> | null = null;

  const resultsArray = Array.from(results);
  for (const obj of resultsArray) {
    if (obj.score > maxScore) {
      maxScore = obj.score;
      maxObj = obj;
    }
  }

  return { maxScore, maxObj };
}

/**
 * Accumulate top-k (highest score) results in accumulator.
 * Maintains a set of the k highest-scoring results seen so far.
 *
 * @param _acc Accumulator object (mutated)
 * @param result New result to consider
 * @param ct Maximum number of results to keep (default 10)
 *
 * NOTE: Initialize _acc as:
 *   { results: new Set(), min: Number.POSITIVE_INFINITY, minResult: null }
 */
export function results_acc<T>(
  _acc: ResultsAccumulator<T>,
  result: ScoredResult<T>,
  ct: number = 10,
): void {
  // If under capacity, just add
  if (_acc.results.size < ct) {
    _acc.results.add(result);

    // Once we reach capacity, find the min threshold
    if (_acc.results.size === ct && _acc.min === Number.POSITIVE_INFINITY) {
      const { minScore, minObj } = find_min(_acc.results);
      _acc.min = minScore;
      _acc.minResult = minObj;
    }
  }
  // If at capacity, only add if score is higher than current min
  else if (result.score > _acc.min) {
    _acc.results.add(result);
    // Remove the old min
    if (_acc.minResult) {
      _acc.results.delete(_acc.minResult);
    }

    // Recalculate new min
    const { minScore, minObj } = find_min(_acc.results);
    _acc.min = minScore;
    _acc.minResult = minObj;
  }
}

/**
 * Accumulate top-k (lowest score) results in accumulator.
 * Maintains a set of the k lowest-scoring results seen so far.
 *
 * @param _acc Accumulator object (mutated)
 * @param result New result to consider
 * @param ct Maximum number of results to keep (default 10)
 *
 * NOTE: Initialize _acc as:
 *   { results: new Set(), max: Number.NEGATIVE_INFINITY, maxResult: null }
 */
export function furthest_acc<T>(
  _acc: FurthestAccumulator<T>,
  result: ScoredResult<T>,
  ct: number = 10,
): void {
  // If under capacity, just add
  if (_acc.results.size < ct) {
    _acc.results.add(result);

    // Once we reach capacity, find the max threshold
    if (_acc.results.size === ct && _acc.max === Number.NEGATIVE_INFINITY) {
      const { maxScore, maxObj } = find_max(_acc.results);
      _acc.max = maxScore;
      _acc.maxResult = maxObj;
    }
  }
  // If at capacity, only add if score is lower than current max
  else if (result.score < _acc.max) {
    _acc.results.add(result);
    // Remove the old max
    if (_acc.maxResult) {
      _acc.results.delete(_acc.maxResult);
    }

    // Recalculate new max
    const { maxScore, maxObj } = find_max(_acc.results);
    _acc.max = maxScore;
    _acc.maxResult = maxObj;
  }
}
