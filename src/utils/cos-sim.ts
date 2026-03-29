/**
 * @file cos-sim.ts
 * @description Cosine similarity helpers for numeric vectors.
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
    const left = vector1[i] ?? 0;
    const right = vector2[i] ?? 0;
    dot_product += left * right;
    magnitude1 += left * left;
    magnitude2 += right * right;
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 < epsilon || magnitude2 < epsilon) return 0;
  return dot_product / (magnitude1 * magnitude2);
}

export function cos_sim_f32(vector1: Float32Array, vector2: Float32Array): number {
  if (vector1.length !== vector2.length) {
    throw new Error('Vectors must have the same length');
  }

  let dot_product = 0;
  let magnitude1 = 0;
  let magnitude2 = 0;
  const epsilon = 1e-8;

  for (let i = 0; i < vector1.length; i++) {
    const left = vector1[i] ?? 0;
    const right = vector2[i] ?? 0;
    dot_product += left * right;
    magnitude1 += left * left;
    magnitude2 += right * right;
  }

  magnitude1 = Math.sqrt(magnitude1);
  magnitude2 = Math.sqrt(magnitude2);

  if (magnitude1 < epsilon || magnitude2 < epsilon) return 0;
  return dot_product / (magnitude1 * magnitude2);
}
