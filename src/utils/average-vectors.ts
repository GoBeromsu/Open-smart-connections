/**
 * @file average-vectors.ts
 * @description Element-wise averaging for numeric vectors.
 */

export function average_vectors(vecs: (number[] | Float32Array)[]): number[] {
  if (vecs.length === 0) return [];

  const dims = vecs[0]?.length ?? 0;
  const out = new Array<number>(dims).fill(0);

  for (const vector of vecs) {
    for (let i = 0; i < dims; i++) {
      out[i] = (out[i] ?? 0) + (vector[i] ?? 0);
    }
  }

  for (let i = 0; i < dims; i++) {
    out[i] = (out[i] ?? 0) / vecs.length;
  }

  return out;
}
