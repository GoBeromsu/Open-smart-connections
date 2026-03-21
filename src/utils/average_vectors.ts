/**
 * @file average_vectors.ts
 * @description Computes the element-wise average of a set of vectors.
 */

/**
 * Compute the element-wise average of one or more vectors.
 * Returns an empty array when no vectors are provided.
 */
export function average_vectors(vecs: number[][]): number[] {
  if (vecs.length === 0) return [];
  const dims = vecs[0].length;
  const out = new Array<number>(dims).fill(0);
  for (const v of vecs) {
    for (let i = 0; i < dims; i++) out[i] += v[i];
  }
  for (let i = 0; i < dims; i++) out[i] /= vecs.length;
  return out;
}
