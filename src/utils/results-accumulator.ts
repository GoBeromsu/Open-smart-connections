/**
 * @file results-accumulator.ts
 * @description Top-k score accumulation helpers.
 */

export interface ScoredResult<T = unknown> {
  item: T;
  score: number;
}

export interface ResultsAccumulator<T = unknown> {
  results: Set<ScoredResult<T>>;
  min: number;
  minResult: ScoredResult<T> | null;
}

function findMin<T>(results: Set<ScoredResult<T>>): { minScore: number; minObj: ScoredResult<T> | null } {
  let minScore = Number.POSITIVE_INFINITY;
  let minObj: ScoredResult<T> | null = null;

  for (const result of results) {
    if (result.score < minScore) {
      minScore = result.score;
      minObj = result;
    }
  }

  return { minScore, minObj };
}

export function results_acc<T>(
  accumulator: ResultsAccumulator<T>,
  result: ScoredResult<T>,
  count: number = 10,
): void {
  if (accumulator.results.size < count) {
    accumulator.results.add(result);

    if (accumulator.results.size === count && accumulator.min === Number.POSITIVE_INFINITY) {
      const { minScore, minObj } = findMin(accumulator.results);
      accumulator.min = minScore;
      accumulator.minResult = minObj;
    }
    return;
  }

  if (result.score <= accumulator.min) {
    return;
  }

  accumulator.results.add(result);
  if (accumulator.minResult) {
    accumulator.results.delete(accumulator.minResult);
  }

  const { minScore, minObj } = findMin(accumulator.results);
  accumulator.min = minScore;
  accumulator.minResult = minObj;
}
