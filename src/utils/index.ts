/**
 * @file index.ts
 * @description Utility functions for the Open Connections plugin
 */

// ── Error helpers ─────────────────────────────────────────────────────────────

/**
 * Extract a string message from an unknown thrown value.
 */
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Cosine similarity ────────────────────────────────────────────────────────

/**
 * Calculate the cosine similarity between two numeric vectors.
 * @param vector1 First vector
 * @param vector2 Second vector
 * @returns Similarity score between 0 and 1
 * @throws Error if vectors have different lengths
 */
export function cos_sim(vector1: number[] | Float32Array = [], vector2: number[] | Float32Array = []): number {
  if (vector1.length !== vector2.length) {
    throw new Error('Vectors must have the same length');
  }

  let dot_product = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;
  const epsilon = 1e-8;

  for (let i = 0; i < vector1.length; i++) {
    dot_product += vector1[i] * vector2[i];
    magnitude1 += vector1[i] * vector1[i];
    magnitude2 += vector2[i] * vector2[i];
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 < epsilon || magnitude2 < epsilon) return 0;

  return dot_product / (magnitude1 * magnitude2);
}

/**
 * Calculate the cosine similarity between two Float32Array vectors.
 * Avoids the `Array.from()` conversion cost of `cos_sim` for binary blob data.
 * @param vector1 First vector
 * @param vector2 Second vector
 * @returns Similarity score between -1 and 1
 * @throws Error if vectors have different lengths
 */
export function cos_sim_f32(vector1: Float32Array, vector2: Float32Array): number {
  if (vector1.length !== vector2.length) {
    throw new Error('Vectors must have the same length');
  }
  let dot_product = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;
  const epsilon = 1e-8;
  for (let i = 0; i < vector1.length; i++) {
    dot_product += vector1[i] * vector2[i];
    magnitude1 += vector1[i] * vector1[i];
    magnitude2 += vector2[i] * vector2[i];
  }
  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);
  if (magnitude1 < epsilon || magnitude2 < epsilon) return 0;
  return dot_product / (magnitude1 * magnitude2);
}

// ── Content hashing ──────────────────────────────────────────────────────────

const _encoder = new TextEncoder();

/**
 * Creates a SHA-256 hash of the given text.
 * @param text Text to hash
 * @returns SHA-256 hash as hex string
 */
export async function create_hash(text: string): Promise<string> {
  // Truncate very large text to avoid performance issues
  if (text.length > 100000) {
    text = text.substring(0, 100000);
  }

  const msgUint8 = _encoder.encode(text.trim());
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

// ── Vector averaging ─────────────────────────────────────────────────────────

/**
 * Compute the element-wise average of one or more vectors.
 * Returns an empty array when no vectors are provided.
 */
export function average_vectors(vecs: (number[] | Float32Array)[]): number[] {
  if (vecs.length === 0) return [];
  const dims = vecs[0].length;
  const out = new Array<number>(dims).fill(0);
  for (const v of vecs) {
    for (let i = 0; i < dims; i++) out[i] += v[i];
  }
  for (let i = 0; i < dims; i++) out[i] /= vecs.length;
  return out;
}

// ── Install date ─────────────────────────────────────────────────────────────

export function determine_installed_at(
  current: number | null,
  data_file_ctime: number | null,
): number | null {
  if (typeof data_file_ctime !== 'number') return current ?? null;
  if (typeof current !== 'number' || data_file_ctime < current) return data_file_ctime;
  return current;
}

// ── Results accumulators ─────────────────────────────────────────────────────

/** Result item with score */
export interface ScoredResult<T = unknown> {
  item: T;
  score: number;
}

/** Accumulator for top-k highest scores */
export interface ResultsAccumulator<T = unknown> {
  results: Set<ScoredResult<T>>;
  min: number;
  minResult: ScoredResult<T> | null;
}

function find_min<T>(results: Set<ScoredResult<T>>): { minScore: number; minObj: ScoredResult<T> | null } {
  let minScore = Number.POSITIVE_INFINITY;
  let minObj: ScoredResult<T> | null = null;

  for (const obj of results) {
    if (obj.score < minScore) {
      minScore = obj.score;
      minObj = obj;
    }
  }

  return { minScore, minObj };
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
  if (_acc.results.size < ct) {
    _acc.results.add(result);

    if (_acc.results.size === ct && _acc.min === Number.POSITIVE_INFINITY) {
      const { minScore, minObj } = find_min(_acc.results);
      _acc.min = minScore;
      _acc.minResult = minObj;
    }
  } else if (result.score > _acc.min) {
    _acc.results.add(result);
    if (_acc.minResult) {
      _acc.results.delete(_acc.minResult);
    }

    const { minScore, minObj } = find_min(_acc.results);
    _acc.min = minScore;
    _acc.minResult = minObj;
  }
}

// ── ETA formatting ───────────────────────────────────────────────────────────

/**
 * Format an ETA in milliseconds as a human-readable string.
 * Returns an empty string when etaMs is null or non-positive.
 */
export function formatEta(etaMs: number | null): string {
  if (etaMs == null || etaMs <= 0) return '';
  const totalSec = Math.ceil(etaMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return min > 0 ? `${min}m ${sec}s` : `${sec}s`;
}

// ── Score sorting ────────────────────────────────────────────────────────────

/** Sort comparator for descending scores (highest first) */
export function sort_by_score_descending<T>(a: ScoredResult<T>, b: ScoredResult<T>): number {
  const epsilon = 1e-9;
  const score_diff = a.score - b.score;
  if (Math.abs(score_diff) < epsilon) return 0;
  return score_diff > 0 ? -1 : 1;
}

/** Sort comparator for ascending scores (lowest first) */
export function sort_by_score_ascending<T>(a: ScoredResult<T>, b: ScoredResult<T>): number {
  return sort_by_score_descending(b, a);
}
