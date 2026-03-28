/**
 * @file flat-vector-index.ts
 * @description In-memory flat vector index using contiguous Float32Array.
 *              Provides fast cosine similarity search without SQLite at query time.
 */

import type { SearchFilter } from '../types/entities';

export type VectorMatch = { entity_key: string; score: number };

const QUERY_CHUNK_SIZE = 1000;

export class FlatVectorIndex {
  private _keys: string[] = [];
  private _matrix: Float32Array = new Float32Array(0);
  private _dims = 0;
  private _size = 0;
  private _keyIndex = new Map<string, number>();

  get size(): number { return this._size; }
  get dims(): number { return this._dims; }

  load(rows: { entity_key: string; vec: Float32Array }[], dims: number): void {
    this._dims = dims;
    this._size = rows.length;
    this._keys = new Array<string>(rows.length);
    this._matrix = new Float32Array(rows.length * dims);
    this._keyIndex.clear();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      this._keys[i] = row.entity_key;
      this._keyIndex.set(row.entity_key, i);
      this._matrix.set(row.vec, i * dims);
    }
  }

  async queryNearest(
    queryVec: number[] | Float32Array,
    filter: SearchFilter,
    limit: number,
  ): Promise<VectorMatch[]> {
    if (this._size === 0 || this._dims === 0) return [];

    const dims = this._dims;
    const mat = this._matrix;
    const qf32 = queryVec instanceof Float32Array ? queryVec : new Float32Array(queryVec);
    if (qf32.length !== dims) return [];

    // Pre-compute query magnitude
    let queryMag = 0;
    for (let d = 0; d < dims; d++) queryMag += qf32[d]! * qf32[d]!;
    queryMag = Math.sqrt(queryMag);
    if (queryMag < 1e-8) return [];

    const excludeSet = filter.exclude ? new Set(filter.exclude) : null;
    const includeSet = filter.include ? new Set(filter.include) : null;
    const minScore = filter.min_score;
    const scored: VectorMatch[] = [];

    for (let start = 0; start < this._size; start += QUERY_CHUNK_SIZE) {
      const end = Math.min(start + QUERY_CHUNK_SIZE, this._size);

      for (let i = start; i < end; i++) {
        const key = this._keys[i]!;
        if (excludeSet?.has(key)) continue;
        if (includeSet && !includeSet.has(key)) continue;
        if (filter.key_starts_with && !key.startsWith(filter.key_starts_with)) continue;
        if (filter.key_does_not_start_with && key.startsWith(filter.key_does_not_start_with)) continue;

        const offset = i * dims;
        let dot = 0, candidateMag = 0;
        for (let d = 0; d < dims; d++) {
          const b = mat[offset + d]!;
          dot += qf32[d]! * b;
          candidateMag += b * b;
        }
        candidateMag = Math.sqrt(candidateMag);
        if (candidateMag < 1e-8) continue;
        const score = dot / (queryMag * candidateMag);

        if (minScore !== undefined && score < minScore) continue;
        scored.push({ entity_key: key, score });
      }

      if (end < this._size) {
        await new Promise<void>(r => setTimeout(r, 0));
      }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  upsert(key: string, vec: Float32Array): void {
    if (vec.length !== this._dims) return;
    const idx = this._keyIndex.get(key);
    if (idx !== undefined) {
      this._matrix.set(vec, idx * this._dims);
      return;
    }
    // Grow: append
    const newSize = this._size + 1;
    const needed = newSize * this._dims;
    if (needed > this._matrix.length) {
      const grown = new Float32Array(Math.max(needed, this._matrix.length * 2));
      grown.set(this._matrix);
      this._matrix = grown;
    }
    this._keys.push(key);
    this._keyIndex.set(key, this._size);
    this._matrix.set(vec, this._size * this._dims);
    this._size = newSize;
  }

  remove(key: string): void {
    const idx = this._keyIndex.get(key);
    if (idx === undefined) return;
    const lastIdx = this._size - 1;
    if (idx !== lastIdx) {
      const lastKey = this._keys[lastIdx]!;
      this._keys[idx] = lastKey;
      this._keyIndex.set(lastKey, idx);
      this._matrix.set(
        this._matrix.subarray(lastIdx * this._dims, (lastIdx + 1) * this._dims),
        idx * this._dims,
      );
    }
    this._keys.pop();
    this._keyIndex.delete(key);
    this._size = lastIdx;
  }

  clear(): void {
    this._keys = [];
    this._matrix = new Float32Array(0);
    this._keyIndex.clear();
    this._size = 0;
  }
}
