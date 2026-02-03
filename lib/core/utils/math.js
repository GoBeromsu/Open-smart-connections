/**
 * @file math.js - Mathematical utilities for vectors and geometry
 */

/**
 * Calculate the cosine similarity between two numeric vectors.
 * @param {number[]} vector1
 * @param {number[]} vector2
 * @returns {number} similarity score between 0 and 1.
 */
export function cos_sim(vector1 = [], vector2 = []) {
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
 * Computes the centroid of an array of points in N-dimensional space.
 * @param {number[][]} points - Array of points, each is an array of numbers
 * @returns {number[]|null} - The centroid as an array, or null if no points
 */
export function compute_centroid(points) {
  if (!points || points.length === 0) {
    return null;
  }
  const n = points.length;
  const dim = points[0].length;
  const sums = new Float64Array(dim);

  for (let i = 0; i < n; i++) {
    const p = points[i];
    for (let d = 0; d < dim; d++) {
      sums[d] += p[d];
    }
  }

  for (let d = 0; d < dim; d++) {
    sums[d] /= n;
  }
  return Array.from(sums);
}

/**
 * Computes the medoid of an array of points in N-dimensional space.
 * @param {number[][]} points - Array of points, each is an array of numbers
 * @returns {number[]|null} - The medoid point as an array, or null if no points
 */
export function compute_medoid(points) {
  if (!points || points.length === 0) {
    return null;
  }
  if (points.length === 1) {
    return points[0];
  }

  const n = points.length;
  const dim = points[0].length;
  const sum_of_distances = new Float64Array(n);

  for (let i = 0; i < n - 1; i++) {
    const p_i = points[i];
    for (let j = i + 1; j < n; j++) {
      const p_j = points[j];
      let dist_sq = 0;
      for (let d = 0; d < dim; d++) {
        const diff = p_i[d] - p_j[d];
        dist_sq += diff * diff;
      }
      const dist = Math.sqrt(dist_sq);
      sum_of_distances[i] += dist;
      sum_of_distances[j] += dist;
    }
  }

  let min_index = 0;
  let min_sum = sum_of_distances[0];
  for (let i = 1; i < n; i++) {
    if (sum_of_distances[i] < min_sum) {
      min_sum = sum_of_distances[i];
      min_index = i;
    }
  }
  return points[min_index];
}
